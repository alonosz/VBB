"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  conversions: { accepted: number; failures: unknown[]; summary: string };
  adjustments: { accepted: number; failures: unknown[]; summary: string };
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
  /*
   * A publish that reached Google and was refused by it is not a success, and
   * for one afternoon this said "Sent" with a green tick above the sentence
   * "Google refused all 466 conversions". The call had returned 200; nothing
   * had landed. Reporting the request rather than the outcome is precisely the
   * failure this product exists to avoid, so the heading is derived from what
   * Google accepted and from nothing else.
   */
  const accepted = result.conversions.accepted;
  const refused = result.conversions.failures.length;
  const landed = accepted > 0;

  const mark = !landed
    ? { glyph: "×", bg: "var(--danger)", title: `Nothing reached ${result.account.name}` }
    : refused > 0
      ? { glyph: "!", bg: "var(--warn)", title: `Partly sent to ${result.account.name}` }
      : { glyph: "✓", bg: "var(--accent)", title: `Sent to ${result.account.name}` };

  return (
    <div className="well mt-4 p-5">
      <p className="flex items-center gap-2 text-[15px] font-bold">
        <span
          aria-hidden
          className="flex size-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: mark.bg }}
        >
          {mark.glyph}
        </span>
        {mark.title}
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

      {/*
        The handover, and it belongs only here.
        
        Setup is walked once; the evaluation is the screen somebody returns to
        for the life of the account, so it needs the weight of a destination
        rather than a link in a paragraph. It also cannot appear before this
        moment: the campaign audit reads the account this publish just
        recorded, so an evaluation opened before a successful send would have
        nothing to say about Google and would teach somebody the screen is
        empty.
      */}
      {/*
        Nothing landed, so the API route is not the way in today. The feed
        below needs no API access at all and is unaffected by whatever Google
        refused here - saying so is more use than leaving somebody staring at
        an error with no second door.
      */}
      {!landed && (
        <p className="mt-3 max-w-[68ch] text-[13px] text-[var(--muted-strong)]">
          Your values have not reached Google. The file route below needs no API
          access and is unaffected, so it is the way through while this is sorted
          out.
        </p>
      )}

      {landed && (
      <div className="mt-5 border-t border-[var(--border)] pt-5">
        <p className="label">From here on</p>
        <h3 className="mt-1.5 text-[15px] font-bold">Check whether it worked</h3>
        <p className="mt-1 max-w-[64ch] text-[13.5px] text-[var(--muted)]">
          Reads your CRM live and compares the leads Google buys now against the
          ones it bought before, with the leads that never came from Google as a
          control. Nothing to re-upload, ever.
        </p>
        <Link href="/evaluation" className="btn btn-primary mt-3.5 text-[13.5px]">
          Open the evaluation
          <ArrowIcon />
        </Link>
        <p className="mono mt-2.5 text-[12px] text-[var(--muted)]">
          Worth bookmarking: /evaluation
        </p>
      </div>
      )}
    </div>
  );
}
