"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { readWorkspaceKey, rememberWorkspaceKey } from "@/lib/workspace/clientKey";
import type { AdsAccount } from "@/lib/sync/google/accounts";
import type { StrategyAudit } from "@/lib/sync/google/campaigns";
import type { FeedRow } from "@/lib/feed/types";
import { StrategyPanel } from "@/components/report/campaignStrategy";

/**
 * Sending the values by API instead of by file.
 *
 * The feed works and is not going anywhere - it is the only route that needs
 * nobody's approval. But it is a shout into the dark: Google reports nothing
 * back, a refused fetch and a dead URL look identical, and the advertiser has
 * to build the conversion action by hand through a six-step wizard where four
 * of the steps have a wrong answer that fails in silence.
 *
 * This route removes all of that. We create the conversion action ourselves,
 * upload against it, and read back per-row errors and which campaigns are on
 * a bid strategy that will ignore everything we just sent.
 */

interface PublishResult {
  account: { customerId: string; name: string; displayId: string };
  conversionAction: { name: string; existed: boolean };
  conversions: { accepted: number; summary: string };
  adjustments: { accepted: number; summary: string };
  strategies: StrategyAudit | null;
}

type Phase = "idle" | "connecting" | "listing" | "sending";

export function ConnectGoogleAds({
  rows,
  currencyCode,
  modelId,
  disabled,
}: {
  /** Finished rows, priced in the browser. The server prices nothing. */
  rows: FeedRow[];
  currencyCode: string;
  modelId: string;
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");

  /*
   * What the callback said, read before the first render rather than set from
   * an effect. Setting state inside an effect costs a second render pass and
   * makes a failure message flash in after the page has settled.
   */
  const [returned] = useState(() => {
    if (typeof window === "undefined") return { connected: false, reason: null as string | null };
    const params = new URLSearchParams(window.location.search);
    return {
      connected: params.get("google") === "connected",
      reason: params.get("google") === "error"
        ? params.get("reason") ?? "Google did not complete the connection."
        : null,
    };
  });

  const [error, setError] = useState<string | null>(returned.reason);
  const [accounts, setAccounts] = useState<AdsAccount[] | null>(null);
  const [usable, setUsable] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const resumed = useRef(false);

  const keepMintedKey = (data: { workspaceKey?: unknown }) => {
    if (typeof data.workspaceKey === "string" && data.workspaceKey.trim()) {
      rememberWorkspaceKey(data.workspaceKey.trim());
    }
  };

  const beginOAuth = useCallback(async () => {
    setPhase("connecting");
    try {
      const res = await fetch("/api/ads/google/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceKey: readWorkspaceKey() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't start the connection.");
        setPhase("idle");
        return;
      }
      keepMintedKey(data);
      window.location.href = data.authorizeUrl as string;
    } catch {
      setError("We couldn't start the connection.");
      setPhase("idle");
    }
  }, []);

  /**
   * One button, two states behind it.
   *
   * "Connect" and "show me my accounts" are the same intent from the
   * advertiser's side, so the button tries the listing first and starts the
   * handshake only when the server says there is no connection yet. Asking
   * them to notice which state they are in is asking them to understand our
   * OAuth flow.
   */
  const loadAccounts = useCallback(async () => {
    setError(null);
    setPhase("listing");
    try {
      const res = await fetch("/api/ads/google/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceKey: readWorkspaceKey() }),
      });
      const data = await res.json();

      // Not connected is not an error, it is the first half of what they asked
      // for.
      if (res.status === 409) {
        await beginOAuth();
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't read your Google Ads accounts.");
        setPhase("idle");
        return;
      }

      const list = data.accounts as AdsAccount[];
      setAccounts(list);
      setUsable(data.usable as string[]);
      // Pre-select where there is no ambiguity: the account they already sent
      // to, or the only one they can send to.
      const already = data.connectedAccountId as string | null;
      const only = (data.usable as string[]).length === 1 ? (data.usable as string[])[0] : null;
      setChosen(already ?? only);
      setPhase("idle");
    } catch {
      setError("We couldn't reach Google Ads. Try again.");
      setPhase("idle");
    }
  }, [beginOAuth]);

  // Coming back from Google, carry on with what they clicked. Once: a failed
  // listing must not send them round the loop again.
  useEffect(() => {
    if (!returned.connected || resumed.current) return;
    resumed.current = true;
    // Queued rather than called: the listing sets state as its first act, and
    // doing that synchronously inside an effect renders twice before the page
    // has painted once.
    queueMicrotask(() => void loadAccounts());
  }, [returned.connected, loadAccounts]);

  async function send() {
    if (!chosen) return;
    setError(null);
    setPhase("sending");
    try {
      const res = await fetch("/api/ads/google/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceKey: readWorkspaceKey(),
          customerId: chosen,
          currencyCode,
          modelId,
          rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Sending the values failed.");
        return;
      }
      setResult(data as PublishResult);
    } catch {
      setError("We couldn't reach Google Ads. Try again.");
    } finally {
      setPhase("idle");
    }
  }

  const working = phase !== "idle";

  if (result) return <Sent result={result} currencyCode={currencyCode} />;

  return (
    <div className="mt-4">
      <p className="max-w-[66ch] text-[13px] text-[var(--muted)]">
        Read-only on everything else: no campaign, budget, bid or keyword is
        touched, and you can disconnect at any time.
      </p>

      {!accounts && (
        <button
          type="button"
          onClick={() => void loadAccounts()}
          disabled={working || disabled}
          className="btn btn-primary mt-3.5 text-[13.5px]"
        >
          {phase === "connecting"
            ? "Opening Google…"
            : phase === "listing"
              ? "Reading your accounts…"
              : "Connect Google Ads"}
          {!working && <ArrowIcon />}
        </button>
      )}

      {accounts && (
        <div className="mt-4">
          <p className="label">Which account?</p>
          {accounts.length === 0 ? (
            <p className="mt-2 max-w-[64ch] text-[13px] text-[var(--muted)]">
              That Google login cannot reach any Google Ads accounts. Sign in with
              one that can.
            </p>
          ) : (
            <div className="mt-2 grid gap-2">
              {accounts.map((a) => {
                const can = usable.includes(a.customerId);
                return (
                  <button
                    key={a.customerId}
                    type="button"
                    onClick={() => can && setChosen(a.customerId)}
                    disabled={!can}
                    aria-pressed={chosen === a.customerId}
                    className={
                      "rounded-xl border px-3.5 py-2.5 text-left transition-colors " +
                      (chosen === a.customerId
                        ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)]/40") +
                      (can ? "" : " cursor-not-allowed opacity-55")
                    }
                  >
                    <span className="block text-[13.5px] font-bold">{a.name}</span>
                    <span className="mono mt-0.5 block text-[11.5px] text-[var(--muted)]">
                      {a.displayId}
                      {a.currencyCode && ` · ${a.currencyCode}`}
                      {a.isManager && " · manager account, holds others rather than running ads"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {chosen && (
            <button
              type="button"
              onClick={() => void send()}
              disabled={working || disabled}
              className="btn btn-primary mt-3.5 text-[13.5px]"
            >
              {phase === "sending"
                ? "Sending…"
                : `Set up and send ${rows.length.toLocaleString()} conversions`}
              {!working && <ArrowIcon />}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2.5 max-w-[64ch] text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What happened, in the detail a feed can never give.
 *
 * The per-row count is the point: a CSV that Google silently rejected reports
 * nothing to anybody, and an advertiser can publish a thousand conversions and
 * see only that nothing changed.
 */
function Sent({ result, currencyCode }: { result: PublishResult; currencyCode: string }) {
  return (
    <div className="well mt-4 p-5">
      <p className="flex items-center gap-2 text-[15px] font-bold">
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white"
        >
          ✓
        </span>
        Sent to {result.account.name}
      </p>

      <ul className="mt-3 grid gap-1.5 text-[13.5px]">
        <li>{result.conversions.summary}</li>
        {result.adjustments.accepted > 0 && <li>{result.adjustments.summary}</li>}
        <li className="text-[var(--muted)]">
          Conversion action{" "}
          <span className="mono">&ldquo;{result.conversionAction.name}&rdquo;</span>{" "}
          {result.conversionAction.existed
            ? "was already set up correctly."
            : "created and configured to take a different value for each lead."}
        </li>
      </ul>

      {/*
        The thing that decides whether any of it mattered, and the reason the
        API route exists at all. Values landing in an account whose campaigns
        bid on lead count change nothing, and Google says so nowhere.
      */}
      {result.strategies && (
        <div className="mt-4">
          <StrategyPanel audit={result.strategies} currencyCode={currencyCode} />
        </div>
      )}
    </div>
  );
}
