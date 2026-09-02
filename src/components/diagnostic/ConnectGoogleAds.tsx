"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { readWorkspaceKey, rememberWorkspaceKey } from "@/lib/workspace/clientKey";
import type { AdsAccount } from "@/lib/sync/google/accounts";
import type { StrategyAudit } from "@/lib/sync/google/campaigns";
import type { AccountReadiness } from "@/lib/sync/google/readiness";
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
 * send against it, and read back which campaigns are on a bid strategy that
 * will ignore everything we just sent.
 *
 * Values go through the Data Manager API, which Google requires of every
 * integration built after June 2026. It answers for the batch rather than the
 * row and records asynchronously, so there is no "462 of 466 accepted" to
 * report any more - which is why the dry run exists. One malformed row
 * rejects everything, and one click is a cheap way to find that out.
 */

interface PublishResult {
  /** True when Google checked the batch and deliberately recorded nothing. */
  validateOnly: boolean;
  account: { customerId: string; name: string; displayId: string };
  conversionAction: { name: string; existed: boolean };
  /** Rows in the request. Not a count of what Google kept - see below. */
  submitted: number;
  requestId: string | null;
  fieldWarnings: unknown[];
  summary: string;
  strategies: StrategyAudit | null;
}

type Phase = "idle" | "connecting" | "listing" | "sending";

export function ConnectGoogleAds({
  rows,
  pricedLeads,
  currencyCode,
  modelId,
  disabled,
}: {
  /** Finished rows, priced in the browser. The server prices nothing. */
  rows: FeedRow[];
  /** Every lead the model priced, so the gap to `rows` can be explained. */
  pricedLeads: number;
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
  /*
   * Keyed by the account it describes, so switching accounts cannot leave the
   * previous one's settings on screen while the new answer is in flight -
   * which is how somebody reads "customer data terms not accepted" about an
   * account that accepted them.
   */
  const [readiness, setReadiness] = useState<
    { customerId: string; value: AccountReadiness } | null
  >(null);
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

  /*
   * Read the account's settings the moment one is picked, not when Send is
   * pressed. Google refuses a batch over a checkbox four screens away and
   * names a field rather than a fix, which is survivable for whoever built
   * this and is where a design partner quietly stops.
   *
   * Silent on failure. This is a courtesy check before the advertiser has
   * done anything wrong, and an error here would accuse their account of a
   * problem that is ours.
   */
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/ads/google/readiness", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceKey: readWorkspaceKey(), customerId: chosen }),
        });
        const data = await res.json();
        if (live && res.ok && data.ok) {
          setReadiness({ customerId: chosen, value: data.readiness as AccountReadiness });
        }
      } catch {
        // Nothing to say. The send still reports whatever Google decides.
      }
    })();
    return () => {
      live = false;
    };
  }, [chosen]);

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

  /**
   * @param clickIdOnly Drop the email half of the feed and send click IDs
   *   alone. The escape hatch from a refusal nothing on our side can clear -
   *   see `emailBlocked` below.
   */
  async function send(validateOnly = false, clickIdOnly = false) {
    if (!chosen) return;
    setError(null);
    setPhase("sending");
    /*
     * Filtered here rather than server-side, for the same reason the values
     * are computed here: the server sends what the browser hands it and
     * decides nothing about which leads are worth sending.
     */
    const sending = clickIdOnly
      ? rows.filter((r) => r.clickId).map((r) => ({ ...r, hashedEmail: null }))
      : rows;
    try {
      const res = await fetch("/api/ads/google/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceKey: readWorkspaceKey(),
          customerId: chosen,
          currencyCode,
          modelId,
          validateOnly,
          rows: sending.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
        }),
      });
      const data = await res.json();
      /*
       * The same recovery the listing has. A connection can go stale between
       * picking an account and sending - a revoked token, or a permission we
       * have started needing since - and a dead end here would leave somebody
       * one click from working with no way to take it.
       */
      if (res.status === 409) {
        await beginOAuth();
        return;
      }
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
  const chosenName =
    accounts?.find((a) => a.customerId === chosen)?.name ?? "Google Ads";

  /*
   * Leads carrying neither a click ID nor an email. Google has nothing to
   * match them to, so they are left out rather than sent with a placeholder -
   * and the button count differs from the lead count above it, which is
   * exactly the kind of unexplained gap that reads as a bug.
   */
  const unmatchable = Math.max(0, pricedLeads - rows.length);

  /*
   * Google refused the account for enhanced conversions for leads. Matched on
   * its words because that is what the API returns, and the alternative -
   * plumbing a code through the route - would carry no more meaning.
   */
  const emailBlocked = /enhanced conversions for leads/i.test(error ?? "");
  const clickIdRows = rows.filter((r) => r.clickId).length;

  /*
   * Whether the leads setting matters to this feed at all. A click-ID-only
   * file goes through an account that has never heard of it, and warning
   * about it anyway would be a red mark on a screen with nothing wrong.
   */
  const hasEmails = rows.some((r) => r.hashedEmail);

  if (result)
    return (
      <Sent
        result={result}
        currencyCode={currencyCode}
        /*
         * The way on from a dry run. Without it the check was a dead end: it
         * replaced the whole step with its own result and left no button to
         * do the thing the check had just cleared, so the only way forward
         * was reloading the page and picking the account again. A test that
         * strands you is worse than no test.
         */
        onSendForReal={result.validateOnly ? () => void send(false) : undefined}
        sending={phase === "sending"}
        error={error}
      />
    );

  return (
    <div className="mt-4">
      <p className="max-w-[66ch] text-[13px] text-[var(--muted)]">
        Read-only on everything else: no campaign, budget, bid or keyword is
        touched, and you can disconnect at any time.
      </p>

      {/*
        Said here, next to the button that causes it, and nowhere earlier.

        Google shows an unverified-app screen while its review is pending, and
        somebody meeting that cold in the middle of connecting an ad account
        stops. It was briefly on the invite page instead, which warned people
        about a screen they were four steps from seeing and made the product
        sound unsure of itself before they had used any of it. A caution
        belongs at the moment it applies.
      */}
      {!accounts && (
        <p className="mt-3 max-w-[64ch] text-[12.5px] text-[var(--muted)]">
          Google is still reviewing this app, so it will say so on the way
          through. Choose Advanced, then continue.
        </p>
      )}

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

          {chosen && readiness?.customerId === chosen && (
            <ReadinessPanel readiness={readiness.value} hasEmails={hasEmails} />
          )}

          {chosen && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              {/*
                "Set up and send 466 conversions" said the wrong thing twice.
                "Set up" reads as more work for somebody who has already done
                four steps, when it is a side effect they never have to think
                about - and it is described in the paragraph above. And
                "conversions" is exactly what the old, broken way sends: 466
                identical events. The whole product is the values attached to
                them, so the button names them, and names where they go.

                "466 lead values" alone was not true either: a row is the lead
                itself - its click ID or hashed email and its arrival date -
                carrying a value, and on a first send Google is receiving
                conversions it never had rather than repricing ones it holds.
                "Leads with their values" is true of both that send and the
                later ones, where some rows really are only a new value.
              */}
              <button
                type="button"
                onClick={() => void send()}
                disabled={working || disabled}
                className="btn btn-primary text-[13.5px]"
              >
                {phase === "sending"
                  ? "Sending…"
                  : `Send ${rows.length.toLocaleString()} leads with their values to ${chosenName}`}
                {!working && <ArrowIcon />}
              </button>
              {/*
                Worth its own button rather than a hidden default. Google
                rejects the entire batch if one row is malformed, so checking
                first costs one click and saves finding out with real
                conversions.
              */}
              <button
                type="button"
                onClick={() => void send(true)}
                disabled={working || disabled}
                className="btn btn-secondary text-[13px]"
              >
                Test it first, send nothing
              </button>
            </div>
          )}

          {chosen && unmatchable > 0 && (
            <p className="mt-2.5 max-w-[64ch] text-[12.5px] text-[var(--muted)]">
              <span className="mono">{unmatchable.toLocaleString()}</span> of your{" "}
              <span className="mono">{pricedLeads.toLocaleString()}</span> priced leads
              carry neither a click ID nor an email address, so Google has nothing to
              match them to. They are left out rather than sent with a placeholder,
              and they still count in your model.
            </p>
          )}
        </div>
      )}

      {error && (
        /*
          whitespace-pre-line because a refusal we recognise carries its fix on
          a second paragraph, and Google's own sentence plus "here is where the
          setting is" run together is exactly the wall of text somebody stops
          reading at.
        */
        <p
          role="alert"
          className="mt-2.5 max-w-[64ch] whitespace-pre-line text-[13px] text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      {/*
        The way out of the one refusal a correct setting does not always
        clear.

        Enhanced conversions for leads can be ticked on in Google Ads and
        Google's API can still refuse the account for it, and there is nothing
        on our side to fix and no way to tell how long it takes. Under
        fast-fail that leaves every row stuck behind the email half of the
        feed, including the great majority that never needed it: a click ID
        matches on its own and always has.

        So it is offered, not taken. Sending fewer leads than the button above
        promises is the advertiser's call, it is stated in leads rather than
        implied, and the ones left out are named as waiting rather than lost.
      */}
      {emailBlocked && clickIdRows > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <p className="max-w-[64ch] text-[13px]">
            You do not have to wait for that. Of your{" "}
            <span className="mono">{rows.length.toLocaleString()}</span> leads,{" "}
            <span className="mono">{clickIdRows.toLocaleString()}</span> carry an ad
            click ID, which Google matches on its own without the setting. Sending
            those now leaves out the{" "}
            <span className="mono">{(rows.length - clickIdRows).toLocaleString()}</span>{" "}
            matched only by email, and they go in the next send once Google accepts
            the account.
          </p>
          <button
            type="button"
            onClick={() => void send(false, true)}
            disabled={working || disabled}
            className="btn btn-secondary mt-3 text-[13px]"
          >
            Send the {clickIdRows.toLocaleString()} click ID leads instead
          </button>
        </div>
      )}

      <EvaluationHandoff unlocked={false} />
    </div>
  );
}

/**
 * The account's own settings, before anything is sent to it.
 *
 * Shown only when there is something to say. A panel of three green ticks on
 * an account that was always fine is noise, and noise is what teaches somebody
 * to skip the panel on the day it turns red.
 */
function ReadinessPanel({
  readiness,
  hasEmails,
}: {
  readiness: AccountReadiness;
  hasEmails: boolean;
}) {
  /*
   * Unknown is not shown either. Google declining to report a field is our
   * problem to understand, not a task to hand the advertiser, and a row
   * saying "Google did not say" is an invitation to worry about nothing.
   */
  const problems = readiness.checks.filter(
    (c) =>
      c.state === "not-ready" &&
      (c.id !== "enhancedConversionsForLeads" || hasEmails)
  );
  if (problems.length === 0) return null;

  return (
    <div className="mt-3.5 rounded-xl border border-[var(--warn)]/35 bg-[var(--warn)]/[0.07] p-3.5">
      <p className="text-[13.5px] font-bold">
        {problems.length === 1
          ? "One thing to switch on in Google Ads first"
          : `${problems.length} things to switch on in Google Ads first`}
      </p>
      <p className="mt-1 max-w-[66ch] text-[12.5px] text-[var(--muted)]">
        Read from the account just now. Google refuses the whole batch over any
        of these and names a field rather than a fix, so it is worth two minutes
        before sending rather than after.
      </p>
      <ul className="mt-3 grid gap-2.5">
        {problems.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <span
              aria-hidden
              className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--warn)] text-[10px] font-bold text-white"
            >
              !
            </span>
            <span className="max-w-[62ch]">
              <span className="block text-[13px] font-semibold">{c.title}</span>
              <span className="mt-0.5 block text-[12.5px] text-[var(--muted)]">{c.fix}</span>
            </span>
          </li>
        ))}
      </ul>
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
function Sent({
  result,
  currencyCode,
  onSendForReal,
  sending,
  error,
}: {
  result: PublishResult;
  currencyCode: string;
  /** Set only after a dry run, which is the one result with a next step. */
  onSendForReal?: () => void;
  sending: boolean;
  error: string | null;
}) {
  /*
   * A publish that reached Google and was refused by it is not a success, and
   * for one afternoon this said "Sent" with a green tick above the sentence
   * "Google refused all 466 conversions". The call had returned 200; nothing
   * had landed. Reporting the request rather than the outcome is precisely the
   * failure this product exists to avoid, so the heading is derived from what
   * Google accepted and from nothing else.
   */
  const landed = !result.validateOnly;

  const mark = result.validateOnly
    ? { glyph: "✓", bg: "var(--primary)", title: "Checked, and nothing was sent" }
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
        <li>{result.summary}</li>
        {result.requestId && (
          <li className="mono text-[12px] text-[var(--muted)]">
            Request {result.requestId}
          </li>
        )}
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
        A dry run is a pass, not a delivery, and the difference has to survive
        somebody skim-reading a green tick.
      */}
      {result.validateOnly && (
        <>
          <p className="mt-3 max-w-[68ch] text-[13px] text-[var(--muted-strong)]">
            Nothing was recorded. Google accepted the format of every row, which
            is the part worth knowing before a real send - it rejects an entire
            batch over one bad row.
          </p>
          {onSendForReal && (
            <button
              type="button"
              onClick={onSendForReal}
              disabled={sending}
              className="btn btn-primary mt-3.5 text-[13.5px]"
            >
              {sending
                ? "Sending…"
                : `Send the ${result.submitted.toLocaleString()} for real`}
              {!sending && <ArrowIcon />}
            </button>
          )}
          {error && (
            <p
              role="alert"
              className="mt-2.5 max-w-[64ch] whitespace-pre-line text-[13px] text-[var(--danger)]"
            >
              {error}
            </p>
          )}
        </>
      )}

      <EvaluationHandoff unlocked={landed} />
    </div>
  );
}

/**
 * The handover, shown from the first moment somebody lands on this step.
 *
 * It was hidden until a successful send, on the reasoning that the evaluation
 * reads the account a publish records and would otherwise open empty. That
 * reasoning still holds for opening it - it does not hold for showing it. The
 * measurement is the reason to connect at all, and hiding it until after the
 * work means the one screen worth returning to is invisible to everybody still
 * deciding whether to do the work. So it is always here, and locked until
 * there is something in it, which says the same thing without teaching anybody
 * that the screen is empty.
 */
function EvaluationHandoff({ unlocked }: { unlocked: boolean }) {
  return (
    <div className="mt-5 border-t border-[var(--border)] pt-5">
      <p className="label">{unlocked ? "From here on" : "After you send"}</p>
      <h3 className="mt-1.5 text-[15px] font-bold">Check whether it worked</h3>
      <p className="mt-1 max-w-[64ch] text-[13.5px] text-[var(--muted)]">
        Reads your CRM live and compares the leads Google buys now against the
        ones it bought before, with the leads that never came from Google as a
        control. Nothing to re-upload, ever.
      </p>

      {unlocked ? (
        <>
          <Link href="/evaluation" className="btn btn-primary mt-3.5 text-[13.5px]">
            Open the evaluation
            <ArrowIcon />
          </Link>
          <p className="mono mt-2.5 text-[12px] text-[var(--muted)]">
            Worth bookmarking: /evaluation
          </p>
        </>
      ) : (
        <>
          {/*
            Deliberately a real, disabled button rather than a greyed link: it
            has to read as a thing that exists and is not ready, not as a thing
            that failed to load.
          */}
          <button
            type="button"
            disabled
            aria-describedby="evaluation-locked"
            className="btn btn-secondary mt-3.5 cursor-not-allowed text-[13.5px] opacity-60"
          >
            <span aria-hidden>🔒</span>
            Open the evaluation
          </button>
          <p
            id="evaluation-locked"
            className="mt-2.5 max-w-[64ch] text-[12.5px] text-[var(--muted)]"
          >
            Opens once your values have actually landed in Google. It compares
            two cohorts of your own leads, so before the first send there is
            nothing on either side of the comparison.
          </p>
        </>
      )}
    </div>
  );
}
