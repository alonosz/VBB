"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { Alert, PageHead } from "@/components/ui";
import { EmailCapture } from "@/components/leads/EmailCapture";
import { VolumeFloorPanel } from "@/components/report/volumeFloor";
import { FlowSkeleton } from "@/components/diagnostic/FlowSkeleton";
import { ArrowIcon } from "@/components/ArrowIcon";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic, valueAllLeads, withOverrides } from "@/lib/analysis";
import { resolveHypotheses } from "@/lib/intake/merge";
import { savedModelToValueModel, saveValueModel } from "@/lib/model/savedModel";
import { recallModel } from "@/lib/model/storage";
import { buildValueModelCsv, downloadCsv } from "@/lib/export/googleAds";
import { bestIdentifier, buildFeedRows } from "@/lib/feed/publish";
import type { FeedIdentifier } from "@/lib/feed/types";
import { isDeploymentOrigin } from "@/lib/feed/origin";
import { readWorkspaceKey } from "@/lib/workspace/clientKey";
import { WorkspaceKeyPrompt } from "@/components/workspace/WorkspaceKeyPrompt";
import { money } from "@/components/report/panels";
import { CONVERSION_NAME } from "@/lib/feed/handlers";

/**
 * The last stage: getting the values into Google Ads.
 *
 * This used to be a panel two thirds of the way down the report, next to a
 * competing download button, which read as two equal options. They are not
 * equal - the feed URL is the product, and the CSV is what you use when your
 * account cannot do scheduled uploads. Giving the delivery its own screen is
 * also the only honest way to say "you are not finished at the report".
 */

interface Published {
  feedUrl: string;
  rowsPublished: number;
  identifier: "clickId" | "email";
  /** Leads sent at a higher value because they reached the gate in time. */
  gateAdjustments: number;
  /** Reached it, but after Google stopped listening. */
  gateTooLate: number;
  gateStage: string | null;
  /**
   * Whether the rule stack that priced these rows was stored with the feed. A
   * feed without it can still be fetched - it just cannot price new leads on
   * its own later.
   */
  modelStored: boolean;
}

/**
 * Creating the conversion action comes first, and is the step people miss.
 *
 * Google matches an uploaded row to a conversion action by name. If no action
 * called "VBB Lead Value" exists, the upload is accepted and every row is
 * rejected - a failure that looks like nothing happening at all. So this is
 * spelled out before the feed URL, not after it.
 */
/**
 * Two routes through Google's wizard, and the file decides which.
 *
 * Note on ordering: Google's current flow is one wizard, and it asks for the
 * data source connection *before* the conversion action is fully set up.
 * These steps used to promise the opposite - create the action, then point
 * Google at the feed - which is how somebody ends up hunting for a screen
 * that no longer comes first. The settings below still all have to be right;
 * they are just reached in Google's order, not ours.
 *
 * A feed keyed on a click ID is the plain offline import: Google matches the
 * gclid against the click it already recorded. A feed keyed on a hashed email
 * is a different product with a different name, enhanced conversions for
 * leads, and it has to be switched on before Google will accept an email as
 * an identifier at all.
 *
 * Told the wrong one, an advertiser reaches the mapping screen, finds a
 * required GCLID row their file has no column for, and is stuck with nothing
 * on screen explaining why. That happened on the first real run of this, which
 * is why these branch on the identifier rather than assuming clicks.
 */
function setupSteps(identifier: FeedIdentifier) {
  const byClick = identifier === "clickId";
  const steps = [
    {
      title: "Open Conversions",
      body: "In Google Ads, click Goals in the left menu, then Conversions → Summary. On older accounts this is Tools & Settings → Measurement → Conversions.",
    },
  ];

  if (!byClick) {
    steps.push({
      title: "Turn on enhanced conversions for leads first",
      body: "Your feed is keyed on a hashed email rather than a click ID, and Google only accepts that once this is on: Goals → Conversions → Settings → Enhanced conversions for leads. Switch it on and accept the terms. Skip this and the import will demand a GCLID column your file does not have.",
    });
  }

  steps.push(
    byClick
      ? {
          title: "Create a new conversion action",
          body: "Click + New conversion action, then Import → CRM, files or other data sources → Track conversions from clicks. Your feed carries click IDs, so this is the route that matches them exactly.",
        }
      : {
          title: "Create a new conversion action",
          body: 'Click + New conversion action, then Import → CRM, files or other data sources. Choose the option that is not "track conversions from clicks" - it will mention enhanced conversions, or skipping click tracking.',
        },
    {
      title: `Name it exactly "${CONVERSION_NAME}"`,
      body: "Case and spacing have to match - this is the name Google looks for in every row of your feed. A mismatch rejects the whole upload.",
    },
    {
      title: "Set the value to vary per conversion",
      body: 'Under Value, choose "Use different values for each conversion". Leave the default value blank. This is the setting that lets your model matter - the other options flatten every lead back to one number.',
    },
    {
      title: "Check the rest, then save",
      body: 'Count: "One". Click-through conversion window: 90 days, or longer if your cycle runs long. Set "Include in Conversions" to Yes so Smart Bidding actually optimises toward it.',
    }
  );

  return steps;
}

function scheduleSteps(identifier: FeedIdentifier) {
  const idColumn = identifier === "clickId" ? "Google Click ID" : "Email";
  return [
    {
      title: "Start the offline data source wizard",
      body: 'Goals → Conversions → New conversion action. On "Choose data sources to measure conversions", tick Conversions offline, then pick HTTPS underneath it and Save and continue.',
    },
    {
      title: "Choose a category",
      body: 'Pick "Qualified lead". Your feed sends what a lead is expected to be worth on arrival, not a completed purchase. This only decides which reporting group it appears in, so it is not fatal either way.',
    },
    {
      title: "Paste the URL exactly as shown above",
      body: "It has to end in .csv - Google checks the file extension off the end of the URL and rejects anything finishing in a query string.",
    },
    {
      title: "Fill in the username and password",
      body: "Google requires both. The username can be anything - your name is fine. For the password, paste your feed key again (the part between the last / and .csv). We accept it there as well as in the URL.",
    },
    {
      /*
       * The step that goes wrong. Google offers to "automatically accept
       * suggestions", and its suggestion is to put your one identifier column
       * into every identifier slot it has: an email into GBRAID and WBRAID,
       * which are click IDs for iOS and app traffic. Nothing downstream ever
       * reports that, so it has to be said here.
       */
      title: "Map the fields, and refuse the suggestions",
      body: `Map ${idColumn} as the identifier, then Conversion_Value and Conversion_Currency to value and currency. Set everything else to None: Google will offer to fill GBRAID, WBRAID and IP address with your ${idColumn} column, and those are different things. Do not click "accept suggestions".`,
    },
    {
      title: "Save",
      body: "Google collects your values on schedule from here on, and republishing serves new leads through the same URL.",
    },
  ];
}

/**
 * The step everything else is for, and the easiest one to leave undone.
 *
 * Maximize Conversions and Target CPA optimise for the *number* of
 * conversions. They read the values we send and bid on none of it. So an
 * advertiser can follow every instruction above, watch the import succeed,
 * and see no change at all - the values arrive and are ignored. Only the two
 * value-based strategies below actually spend differently because of them.
 */
const BID_STEPS = [
  {
    title: "Open the campaign you want to change",
    body: "Campaigns → pick the campaign → Settings → Bidding. Do this per campaign; the conversion action is account-wide, the bid strategy is not.",
  },
  {
    title: 'Switch it to "Maximize conversion value"',
    body: 'If it currently says Maximize conversions or Target CPA, that is the problem - those bid on how many leads you get, not what they are worth.',
  },
  {
    title: "Leave Target ROAS empty for now",
    body: "A target is a promise about a ratio Google has no history for yet. Let it run on Maximize conversion value first, then set a target once you can see what your actual return has been.",
  },
  {
    title: "Expect a quiet couple of weeks",
    body: "Google re-learns when a bid strategy changes, and it needs a run of real values before that settles. Judge it on what happens after, not during.",
  },
];

export default function ConnectPage() {
  const router = useRouter();
  const { file, fields, currency, businessContext, stageTiming, intake, restored } = useDiagnostic();

  const [feed, setFeed] = useState<Published | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [csvNote, setCsvNote] = useState<string | null>(null);
  /** Set when publishing was refused for want of a key, so we can ask for it. */
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    // Wait for the saved snapshot to be read. Redirecting before it lands
    // would send someone who just refreshed back to the start, a frame before
    // their work reappears.
    if (restored && !file) router.replace("/diagnostic/upload");
  }, [restored, file, router]);

  const saved = useMemo(() => (typeof window === "undefined" ? null : recallModel()), []);

  const { customSignalKeys, hypotheses } = useMemo(
    () =>
      intake?.status === "ready"
        ? resolveHypotheses(intake.proposal, fields)
        : { hypotheses: [], customSignalKeys: [] },
    [intake, fields]
  );

  const mapped = useMemo(() => {
    if (!file) return null;
    return rowsToDeals({ rows: file.rows, fields, currency, stageTiming, signalColumns: customSignalKeys });
  }, [file, fields, currency, stageTiming, customSignalKeys]);

  const { gate, volume } = useMemo(() => {
    if (!mapped) return { gate: null, volume: null };
    const result = runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
      customSignalKeys,
      hypotheses,
    });
    return { gate: result.gate, volume: result.volume };
  }, [mapped, businessContext, currency.reportingCurrency, customSignalKeys, hypotheses]);

  // Fixed for the life of the screen, so re-rendering cannot hand two halves
  // of the same publish two different model ids.
  const [freshModelId] = useState(() => `fresh-${new Date().toISOString().slice(0, 10)}`);

  const { valued, artifact } = useMemo(() => {
    if (!mapped) return { valued: [], artifact: null };
    const result = runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
      customSignalKeys,
      hypotheses,
    });
    const model = saved ? savedModelToValueModel(saved) : result.valueModel;
    const applied = withOverrides(model, mapped.deals, {});
    return {
      valued: valueAllLeads(mapped.deals, applied),
      // Published alongside the rows so a scheduled run can price tomorrow's
      // leads with the same stack. A model the advertiser already saved is
      // already the artifact; a fresh fit is frozen here, under the same id the
      // rows carry, so the two can never disagree about what priced them.
      artifact:
        saved ??
        saveValueModel(applied, { deals: mapped.deals, modelId: freshModelId, gate: result.gate }),
    };
  }, [mapped, businessContext, currency.reportingCurrency, customSignalKeys, hypotheses, saved, freshModelId]);

  /*
   * Which identifier the feed carries, and who decides.
   *
   * This used to be `bestIdentifier` alone: whichever column covered more
   * leads won, silently, with nothing on screen saying so or letting anyone
   * disagree. Two things were wrong with that.
   *
   * A click ID matches the exact click Google recorded. An email is matched
   * against what Google can find, so a click ID on 40% of leads is often
   * worth more than an email on 90%. Coverage alone is the wrong test.
   *
   * And the two routes need completely different setups in Google Ads: the
   * email one lives behind enhanced conversions for leads, which has to be
   * switched on first. Picking it for someone who then cannot find that
   * setting leaves them at a required GCLID row with no way forward. That
   * happened on the first real run.
   *
   * So the suggestion stands, and it is now a suggestion. Principle 3: every
   * rule the product applies is visible and arguable.
   */
  const suggested = useMemo(() => bestIdentifier(valued), [valued]);
  const [chosenIdentifier, setChosenIdentifier] = useState<FeedIdentifier | null>(null);
  const identifier = chosenIdentifier ?? suggested;

  const coverage = useMemo(() => {
    let clicks = 0;
    let emails = 0;
    for (const { deal } of valued) {
      if (deal.clickId?.trim()) clicks++;
      if (deal.email?.trim()) emails++;
    }
    return { clicks, emails, total: valued.length };
  }, [valued]);
  const setup = useMemo(() => setupSteps(identifier), [identifier]);
  const schedule = useMemo(() => scheduleSteps(identifier), [identifier]);


  // Same markup on the server and during hydration; the restored flow only
  // exists in the browser and appears on the pass after.
  if (!restored) return <FlowSkeleton />;
  if (!file || !mapped) return null;

  const cur = currency.reportingCurrency;
  const priced = valued.filter((v) => v.value > 0);
  const values = priced.map((v) => v.value).sort((a, b) => a - b);
  const modelId = saved?.modelId ?? freshModelId;

  async function publish() {
    if (!mapped) return;
    setPublishing(true);
    setError(null);
    try {
      // Deliberately the chosen one, not bestIdentifier again: recomputing
      // here would publish a feed keyed differently from the instructions
      // shown two inches above the button.
      const { rows, skipped, gateAdjustments, gateTooLate } = await buildFeedRows({
        leads: valued,
        modelId,
        currencyCode: cur,
        identifier,
        gate,
      });
      if (rows.length === 0) {
        setError(
          skipped[0]?.reason
            ? `Nothing to publish - every lead had ${skipped[0].reason}.`
            : "Nothing to publish."
        );
        return;
      }
      const res = await fetch("/api/feeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Publishing creates something and so is authorised by the workspace
          // key, never by the feed token.
          workspaceKey: readWorkspaceKey(),
          modelId,
          modelFittedAt: saved?.fittedAt ?? null,
          currencyCode: cur,
          identifier,
          rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
          model: artifact,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "The feed could not be published.");
        // 401 here means the key is missing or wrong, which is a thing the
        // customer can fix on the spot rather than a dead end.
        setNeedsKey(res.status === 401);
      } else
        setFeed({
          feedUrl: data.feedUrl,
          rowsPublished: data.rowsPublished,
          identifier: data.identifier,
          gateAdjustments,
          gateTooLate,
          gateStage: gate?.available ? gate.stage : null,
          modelStored: data.modelStored === true,
        });
    } catch {
      setError("The feed could not be published. Nothing was sent.");
    } finally {
      setPublishing(false);
    }
  }

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // The URL is on screen and selectable.
    }
  }

  async function downloadFile() {
    const r = await buildValueModelCsv({
      leads: valued,
      conversionName: "VBB Lead Value",
      currencyCode: cur,
      identifier,
    });
    downloadCsv("vbb-lead-values-google-ads.csv", r.csv);
    setCsvNote(
      `${r.included.toLocaleString()} conversion${r.included === 1 ? "" : "s"} written` +
        (r.skippedReason ? ` · ${r.skippedReason}` : "")
    );
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="connect" />

      <main className="page animate-page-in flex-1 py-10">
        <PageHead
          eyebrow="Step 5 of 5 · Connect"
          title="Send these values to Google Ads"
        />
        <p className="lede mt-3 max-w-[68ch]">
          Your model has priced{" "}
          <span className="mono font-semibold text-[var(--foreground)]">
            {priced.length.toLocaleString()}
          </span>{" "}
          leads, from{" "}
          <span className="mono font-semibold text-[var(--foreground)]">
            {money(values[0] ?? 0, cur)}
          </span>{" "}
          to{" "}
          <span className="mono font-semibold text-[var(--foreground)]">
            {money(values[values.length - 1] ?? 0, cur)}
          </span>
          . Right now Google counts every one of them as a single identical conversion.
          This is the step that changes that.
        </p>

        {/* ---- the product: a URL Google fetches by itself ---- */}
        <section className="card mt-8 border-[var(--primary)]/25 p-6 sm:p-7">
          <p className="label" style={{ color: "var(--primary-deep)" }}>
            Recommended
          </p>
          <h2 className="h2 mt-2">Give Google a URL to fetch</h2>
          <p className="mt-1 max-w-[68ch] text-[14px] text-[var(--muted)]">
            You paste one link into Google Ads, once. It collects your values on a
            schedule from then on - no file to download, nothing to remember daily.
          </p>

          {!feed ? (
            <>
              {/*
                The choice that used to be made silently. Shown before the
                steps because it changes them: the two routes need different
                things switched on in Google Ads.
              */}
              <div className="well mb-5 p-4">
                <p className="label">How Google matches these to clicks</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {(["clickId", "email"] as FeedIdentifier[]).map((option) => {
                    const chosen = identifier === option;
                    const count = option === "clickId" ? coverage.clicks : coverage.emails;
                    const share =
                      coverage.total > 0 ? Math.round((count / coverage.total) * 100) : 0;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setChosenIdentifier(option)}
                        aria-pressed={chosen}
                        disabled={count === 0}
                        className={
                          "rounded-xl border px-3.5 py-2.5 text-left transition-colors " +
                          (chosen
                            ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                            : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)]/40") +
                          (count === 0 ? " cursor-not-allowed opacity-50" : "")
                        }
                      >
                        <span className="block text-[13.5px] font-bold">
                          {option === "clickId" ? "Click ID" : "Hashed email"}
                          {option === suggested && (
                            <span className="ml-2 text-[11px] font-semibold text-[var(--muted)]">
                              suggested
                            </span>
                          )}
                        </span>
                        <span className="mono mt-0.5 block text-[11.5px] text-[var(--muted)]">
                          {count.toLocaleString()} of {coverage.total.toLocaleString()} leads · {share}%
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2.5 max-w-[66ch] text-[12.5px] text-[var(--muted)]">
                  {identifier === "clickId" ? (
                    <>
                      A click ID matches the exact click Google recorded, so every
                      row that has one lands precisely. Leads without one are left
                      out of the feed rather than guessed at.
                    </>
                  ) : (
                    <>
                      An email is matched against what Google can find, which
                      reaches more leads but less precisely.{" "}
                      <span className="font-semibold text-[var(--foreground)]">
                        This route needs enhanced conversions for leads switched on
                        in Google Ads first
                      </span>{" "}
                      - without it the import will insist on a click ID column your
                      feed does not have.
                    </>
                  )}
                </p>
                {coverage.clicks === 0 && (
                  <p className="mt-2 max-w-[66ch] text-[12.5px] text-[var(--muted)]">
                    No lead in this file carries a click ID, so only the email route
                    is available. The tracking snippet on the next screen fixes that
                    for future leads.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void publish()}
                disabled={publishing}
                className="btn btn-primary btn-lg mt-5"
              >
                {publishing ? "Publishing…" : "Generate my feed URL"}
                {!publishing && <ArrowIcon />}
              </button>
              {error && (
                <div className="mt-4">
                  <Alert tone="bad" title="The feed wasn't published">
                    <p className="text-[13.5px]">{error}</p>
                  </Alert>
                </div>
              )}

              {needsKey && (
                <WorkspaceKeyPrompt
                  onSaved={() => {
                    setNeedsKey(false);
                    setError(null);
                    void publish();
                  }}
                />
              )}
            </>
          ) : (
            <>
              <div className="panel-navy mt-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="flex items-center gap-2 text-[15px] font-bold" style={{ color: "var(--on-navy)" }}>
                    <span
                      aria-hidden
                      className="flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white"
                    >
                      ✓
                    </span>
                    Your feed is live
                  </p>
                  <p className="mono text-[12px]" style={{ color: "var(--on-navy-muted)" }}>
                    {feed.rowsPublished.toLocaleString()} conversions ·{" "}
                    {feed.identifier === "clickId" ? "click ID" : "hashed email"}
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--navy-line)] bg-black/30 px-3 py-2.5 text-[12px]" style={{ color: "var(--on-navy)" }}>
                    {feed.feedUrl}
                  </code>
                  <button type="button" onClick={copy} className="btn btn-primary shrink-0 text-[13px]">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {isDeploymentOrigin(feed.feedUrl) && (
                  <p className="mt-2.5 max-w-[70ch] rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-3 py-2 text-[12.5px] text-[var(--foreground)] mt-3.5">
                    This link points at a single deployment rather than your live
                    site, so it will stop reflecting changes the next time you
                    ship - and it may be behind hosting protection Google
                    can&apos;t get past. Open the app on your normal domain and
                    publish again before giving this to Google Ads.
                  </p>
                )}
                {!feed.modelStored && (
                  <p className="mt-2.5 max-w-[70ch] rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-3 py-2 text-[12.5px] text-[var(--foreground)] mt-3.5">
                    Google will fetch these values normally, but the rule stack
                    behind them was not stored with the feed. That only matters
                    later: this feed cannot price new leads on its own, so
                    refreshing it means coming back here with a new export.
                  </p>
                )}
                {feed.gateStage && (feed.gateAdjustments > 0 || feed.gateTooLate > 0) && (
                  <p className="mt-3.5 max-w-[70ch] text-[12.5px]" style={{ color: "var(--on-navy-muted)" }}>
                    {feed.gateAdjustments > 0 && (
                      <>
                        <span className="mono font-semibold text-[var(--accent)]">
                          {feed.gateAdjustments.toLocaleString()}
                        </span>{" "}
                        {feed.gateAdjustments === 1 ? "lead" : "leads"} reached{" "}
                        <span className="mono">{feed.gateStage}</span> in time and went
                        up in value.{" "}
                      </>
                    )}
                    {feed.gateTooLate > 0 && (
                      <>
                        <span className="mono font-semibold" style={{ color: "var(--on-navy)" }}>
                          {feed.gateTooLate.toLocaleString()}
                        </span>{" "}
                        reached it after Google&apos;s 7-day window, so{" "}
                        {feed.gateTooLate === 1 ? "it kept its" : "they kept their"}{" "}
                        original value - that outcome feeds the next refit instead.
                      </>
                    )}
                  </p>
                )}

                <p className="mt-3.5 max-w-[70ch] text-[12.5px]" style={{ color: "var(--on-navy-muted)" }}>
                  <span className="font-semibold" style={{ color: "var(--warn-on-navy)" }}>
                    Copy it now.
                  </span>{" "}
                  The key is stored only as a hash, so we can&apos;t show it again - and
                  anyone holding it can read the feed.
                </p>
              </div>

              <p className="mt-3 text-[12.5px] text-[var(--muted)]">
                Google fetches on its own schedule and reports nothing back. When
                you want to know whether it has actually collected these values,{" "}
                <a href="/feed-status" className="font-semibold text-[var(--primary)] underline underline-offset-2">
                  check your feed
                </a>{" "}
                - keep the URL above, it is the only way in.
              </p>

              <div className="mt-6 border-t border-[var(--border)] pt-5">
                <p className="label">The settings that decide whether this works</p>
                <p className="mt-1.5 text-[16px] font-bold">
                  Your conversion action in Google Ads
                </p>
                <p className="mt-1 max-w-[64ch] text-[13.5px] text-[var(--muted)]">
                  Google matches each row in your feed to a conversion action{" "}
                  <span className="font-semibold text-[var(--foreground)]">by name</span>.
                  If it doesn&apos;t already have one called{" "}
                  <span className="mono rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[12.5px]">
                    {CONVERSION_NAME}
                  </span>
                  , the upload succeeds and every row is thrown away - which looks
                  exactly like nothing happening.
                </p>
                <ol className="mt-3.5 grid gap-3">
                  {setup.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="mono mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[12px] font-bold text-[var(--primary-deep)]">
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[14px] font-semibold">{step.title}</span>
                        <span className="mt-0.5 block max-w-[62ch] text-[13.5px] text-[var(--muted)]">
                          {step.body}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="mt-6 border-t border-[var(--border)] pt-5">
                <p className="label">Pointing Google at your feed</p>
                <ol className="mt-3 grid gap-3">
                  {schedule.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="mono mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-[12px] font-bold text-[var(--on-navy)]">
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[14px] font-semibold">{step.title}</span>
                        <span className="mt-0.5 block max-w-[62ch] text-[13.5px] text-[var(--muted)]">
                          {step.body}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3">
                  <p className="text-[13px] font-semibold">If Google shows an error</p>
                  <ul className="mt-1.5 grid gap-1 text-[13px] text-[var(--muted)]">
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        Unable to read file format
                      </span>{" "}
                      - the URL was shortened or edited and no longer ends in{" "}
                      <span className="mono">.csv</span>. Paste it again in full.
                    </li>
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        Unknown conversion action
                      </span>{" "}
                      - the name doesn&apos;t match{" "}
                      <span className="mono">{CONVERSION_NAME}</span> exactly.
                    </li>
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        No conversions found
                      </span>{" "}
                      - the clicks are older than your conversion window, or the account
                      never saw them.
                    </li>
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        Every value is the same
                      </span>{" "}
                      - the action is not set to &ldquo;use different values&rdquo;.
                    </li>
                  </ul>
                </div>
              </div>

              {/* The last mile. Without it everything above is inert, so it
                  gets the emphasis surface rather than a fourth grey list. */}
              <div className="mt-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--navy)] to-[var(--navy-soft)] p-5 text-white">
                <p className="label text-white/60">Last, and the one that makes the rest matter</p>
                <p className="mt-1 text-[15px] font-bold">
                  Tell the campaign to bid on value
                </p>
                <p className="mt-1.5 max-w-[64ch] text-[13.5px] text-white/75">
                  Everything above gets your values into Google. It does not make
                  Google <em>use</em> them. A campaign running{" "}
                  <span className="font-semibold text-white">Maximize conversions</span>{" "}
                  or <span className="font-semibold text-white">Target CPA</span> is
                  optimising for how many leads it can get, and will read every value
                  you send and bid on none of it.
                </p>
                <ol className="mt-4 grid gap-3">
                  {BID_STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface)]/15 text-[12px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span>
                        <span className="block text-[14px] font-semibold">{step.title}</span>
                        <span className="mt-0.5 block max-w-[62ch] text-[13.5px] text-white/70">
                          {step.body}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </section>

        {/* ---- the fallback, clearly secondary ---- */}
        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-bold">Or upload a file yourself</p>
              <p className="mt-0.5 max-w-[58ch] text-[13.5px] text-[var(--muted)]">
                Same values, as a CSV in Google&apos;s import format. Use this if your
                account can&apos;t do scheduled uploads - you&apos;ll need to repeat it
                each time you have new leads.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void downloadFile()}
              className="btn btn-secondary shrink-0 text-[13px]"
            >
              Download CSV
            </button>
          </div>
          {csvNote && <p className="mono mt-2.5 text-[12px] text-[var(--muted)]">{csvNote}</p>}
        </section>

        {volume && (
          <div className="mt-4">
            <VolumeFloorPanel volume={volume} currency={cur} />
          </div>
        )}

        {/* ---- the next thing worth doing ---- */}
        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-[14px] font-bold">Then: raise your match rate</p>
          <p className="mt-0.5 max-w-[66ch] text-[13.5px] text-[var(--muted)]">
            A lead carrying an ad click ID matches exactly. One without relies on Google
            finding the click itself. A one-line script on your site closes that gap for
            every future lead.
          </p>
          <button
            type="button"
            onClick={() => router.push("/snippet")}
            className="btn btn-secondary mt-3 text-[13px]"
          >
            Get the tracking snippet
          </button>
        </section>

        {/*
          The last thing on the last screen, and the best moment in the product
          to ask. They have seen their own model, published a feed, and are out
          of steps: there is nothing left for this to compete with, and whatever
          they do next happens in Google Ads rather than here.

          Nothing from their file goes with the address - not the spread, not
          the lead count, not a value - and the copy says so, because after five
          screens of "your data stays in your browser" it is the thing they will
          wonder about.
        */}
        <section className="well mt-4 p-5">
          <EmailCapture
            source="flow"
            step="connect"
            title="Want a second pair of eyes on this?"
            body="Leave your address and we will get in touch about what your model is showing, and how the first weeks of bidding go. Your numbers stay in this browser; only the address is sent."
            cta="Get in touch"
          />
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
          <p className="max-w-[56ch] text-[13px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">From here on:</span>{" "}
            re-run this with a fresh export when you want to send new leads. Your saved
            model keeps pricing them the same way until the data moves enough to justify
            refitting - and the report tells you when it has.
          </p>
          <button
            type="button"
            onClick={() => router.push("/diagnostic/report")}
            className="btn btn-secondary shrink-0"
          >
            Back to your model
          </button>
        </div>
      </main>
    </div>
  );
}
