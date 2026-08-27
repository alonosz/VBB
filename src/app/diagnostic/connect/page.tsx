"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { ArrowIcon } from "@/components/ArrowIcon";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic, valueAllLeads, withOverrides } from "@/lib/analysis";
import { resolveHypotheses } from "@/lib/intake/merge";
import { savedModelToValueModel, saveValueModel } from "@/lib/model/savedModel";
import { recallModel } from "@/lib/model/storage";
import { buildValueModelCsv, downloadCsv } from "@/lib/export/googleAds";
import { bestIdentifier, buildFeedRows } from "@/lib/feed/publish";
import { money } from "@/components/report/panels";
import { CONVERSION_NAME } from "@/lib/feed/handlers";

/**
 * The last stage: getting the values into Google Ads.
 *
 * This used to be a panel two thirds of the way down the report, next to a
 * competing download button, which read as two equal options. They are not
 * equal — the feed URL is the product, and the CSV is what you use when your
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
   * feed without it can still be fetched — it just cannot price new leads on
   * its own later.
   */
  modelStored: boolean;
}

/**
 * Creating the conversion action comes first, and is the step people miss.
 *
 * Google matches an uploaded row to a conversion action by name. If no action
 * called "VBB Lead Value" exists, the upload is accepted and every row is
 * rejected — a failure that looks like nothing happening at all. So this is
 * spelled out before the feed URL, not after it.
 */
const SETUP_STEPS = [
  {
    title: "Open Conversions",
    body: 'In Google Ads, click Goals in the left menu, then Conversions → Summary. On older accounts this is Tools & Settings → Measurement → Conversions.',
  },
  {
    title: "Create a new conversion action",
    body: 'Click + New conversion action, then choose Import → CRM, files or other data sources → Track conversions from clicks.',
  },
  {
    title: `Name it exactly "${CONVERSION_NAME}"`,
    body: "Case and spacing have to match — this is the name Google looks for in every row of your feed. A mismatch rejects the whole upload.",
  },
  {
    title: "Set the value to vary per conversion",
    body: 'Under Value, choose "Use different values for each conversion". Leave the default value blank. This is the setting that lets your model matter — the other options flatten every lead back to one number.',
  },
  {
    title: "Check the rest, then save",
    body: 'Count: "One". Click-through conversion window: 90 days, or longer if your cycle runs long. Set "Include in Conversions" to Yes so Smart Bidding actually optimises toward it.',
  },
];

const SCHEDULE_STEPS = [
  {
    title: "Start the offline data source wizard",
    body: 'Goals → Conversions → New conversion action again — this second pass sets up the delivery, not another action. On "Choose data sources to measure conversions", tick Conversions offline.',
  },
  {
    title: "Add HTTPS as the data source",
    body: 'On "Add an offline data source", leave "Connect a new product" selected and pick HTTPS from the grid — it sits next to Google Sheets and SFTP. Tick the customer-data consent box, then Done, then Save and continue.',
  },
  {
    title: "Paste the URL exactly as shown above",
    body: "It has to end in .csv — Google checks the file extension off the end of the URL and rejects anything finishing in a query string.",
  },
  {
    title: "Fill in the username and password",
    body: "Google requires both. The username can be anything — your name is fine. For the password, paste your feed key again (the part between the last / and .csv). We accept it there as well as in the URL.",
  },
  {
    title: "Map the fields, then review",
    body: 'Google walks you through "Select data" and "Map fields". The column names in the file already match what it expects, so this should confirm rather than require choices.',
  },
  {
    title: "Save",
    body: "Google collects your values on schedule from here on, and republishing serves new leads through the same URL.",
  },
];

/**
 * The step everything else is for, and the easiest one to leave undone.
 *
 * Maximize Conversions and Target CPA optimise for the *number* of
 * conversions. They read the values we send and bid on none of it. So an
 * advertiser can follow every instruction above, watch the import succeed,
 * and see no change at all — the values arrive and are ignored. Only the two
 * value-based strategies below actually spend differently because of them.
 */
const BID_STEPS = [
  {
    title: "Open the campaign you want to change",
    body: "Campaigns → pick the campaign → Settings → Bidding. Do this per campaign; the conversion action is account-wide, the bid strategy is not.",
  },
  {
    title: 'Switch it to "Maximize conversion value"',
    body: 'If it currently says Maximize conversions or Target CPA, that is the problem — those bid on how many leads you get, not what they are worth.',
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
  const { file, fields, currency, businessContext, stageTiming, intake } = useDiagnostic();

  const [feed, setFeed] = useState<Published | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [csvNote, setCsvNote] = useState<string | null>(null);

  useEffect(() => {
    if (!file) router.replace("/diagnostic/upload");
  }, [file, router]);

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

  const gate = useMemo(() => {
    if (!mapped) return null;
    return runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
      customSignalKeys,
      hypotheses,
    }).gate;
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
        saved ?? saveValueModel(applied, { deals: mapped.deals, modelId: freshModelId }),
    };
  }, [mapped, businessContext, currency.reportingCurrency, customSignalKeys, hypotheses, saved, freshModelId]);

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
      const identifier = bestIdentifier(valued);
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
            ? `Nothing to publish — every lead had ${skipped[0].reason}.`
            : "Nothing to publish."
        );
        return;
      }
      const res = await fetch("/api/feeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelId,
          modelFittedAt: saved?.fittedAt ?? null,
          currencyCode: cur,
          identifier,
          rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
          model: artifact,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(data.error ?? "The feed could not be published.");
      else
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
    const identifier = bestIdentifier(valued);
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

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <p className="label mb-2">Step 5 of 5</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Send these values to Google Ads
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] text-[var(--muted)]">
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
        <section className="card mt-7 border-[var(--primary)]/25 p-6">
          <p className="label">Recommended</p>
          <h2 className="mt-1.5 text-xl font-bold tracking-tight">
            Give Google a URL to fetch
          </h2>
          <p className="mt-1 max-w-[68ch] text-[14px] text-[var(--muted)]">
            You paste one link into Google Ads, once. It collects your values on a
            schedule from then on — no file to download, nothing to remember daily.
          </p>

          {!feed ? (
            <>
              <button
                type="button"
                onClick={() => void publish()}
                disabled={publishing}
                className="btn btn-primary mt-4"
              >
                {publishing ? "Publishing…" : "Generate my feed URL"}
                {!publishing && <ArrowIcon />}
              </button>
              {error && (
                <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-red-50 px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
                  {error}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[#f8fafd] p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13.5px] font-bold text-[var(--accent)]">
                    ✓ Your feed is live
                  </p>
                  <p className="mono text-[12px] text-[var(--muted)]">
                    {feed.rowsPublished.toLocaleString()} conversions ·{" "}
                    {feed.identifier === "clickId" ? "click ID" : "hashed email"}
                  </p>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-[12px]">
                    {feed.feedUrl}
                  </code>
                  <button type="button" onClick={copy} className="btn btn-primary shrink-0 text-[13px]">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {!feed.modelStored && (
                  <p className="mt-2.5 max-w-[70ch] rounded-lg border border-[var(--warn)]/40 bg-amber-50 px-3 py-2 text-[12.5px] text-[var(--foreground)]">
                    Google will fetch these values normally, but the rule stack
                    behind them was not stored with the feed. That only matters
                    later: this feed cannot price new leads on its own, so
                    refreshing it means coming back here with a new export.
                  </p>
                )}
                {feed.gateStage && (feed.gateAdjustments > 0 || feed.gateTooLate > 0) && (
                  <p className="mt-2.5 max-w-[70ch] text-[12.5px] text-[var(--muted)]">
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
                        <span className="mono font-semibold">
                          {feed.gateTooLate.toLocaleString()}
                        </span>{" "}
                        reached it after Google&apos;s 7-day window, so{" "}
                        {feed.gateTooLate === 1 ? "it kept its" : "they kept their"}{" "}
                        original value — that outcome feeds the next refit instead.
                      </>
                    )}
                  </p>
                )}

                <p className="mt-2.5 max-w-[70ch] text-[12.5px] text-[var(--muted)]">
                  <span className="font-semibold text-[var(--warn)]">Copy it now.</span>{" "}
                  The key is stored only as a hash, so we can&apos;t show it again — and
                  anyone holding it can read the feed.
                </p>
              </div>

              <p className="mt-3 text-[12.5px] text-[var(--muted)]">
                Google fetches on its own schedule and reports nothing back. When
                you want to know whether it has actually collected these values,{" "}
                <a href="/feed-status" className="font-semibold text-[var(--primary)] underline underline-offset-2">
                  check your feed
                </a>{" "}
                — keep the URL above, it is the only way in.
              </p>

              <div className="mt-6 border-t border-[var(--border)] pt-5">
                <p className="label">Do this once, first</p>
                <p className="mt-1 text-[15px] font-bold">
                  Create the conversion action in Google Ads
                </p>
                <p className="mt-1 max-w-[64ch] text-[13.5px] text-[var(--muted)]">
                  Google matches each row in your feed to a conversion action{" "}
                  <span className="font-semibold text-[var(--foreground)]">by name</span>.
                  If it doesn&apos;t already have one called{" "}
                  <span className="mono rounded bg-[#f1f3f8] px-1.5 py-0.5 text-[12.5px]">
                    {CONVERSION_NAME}
                  </span>
                  , the upload succeeds and every row is thrown away — which looks
                  exactly like nothing happening.
                </p>
                <ol className="mt-3.5 grid gap-3">
                  {SETUP_STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[12px] font-bold text-[var(--primary)]">
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
                <p className="label">Then point Google at your feed</p>
                <ol className="mt-3 grid gap-3">
                  {SCHEDULE_STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-[12px] font-bold text-white">
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

                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[#f8fafd] px-4 py-3">
                  <p className="text-[13px] font-semibold">If Google shows an error</p>
                  <ul className="mt-1.5 grid gap-1 text-[13px] text-[var(--muted)]">
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        Unable to read file format
                      </span>{" "}
                      — the URL was shortened or edited and no longer ends in{" "}
                      <span className="mono">.csv</span>. Paste it again in full.
                    </li>
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        Unknown conversion action
                      </span>{" "}
                      — the name doesn&apos;t match{" "}
                      <span className="mono">{CONVERSION_NAME}</span> exactly.
                    </li>
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        No conversions found
                      </span>{" "}
                      — the clicks are older than your conversion window, or the account
                      never saw them.
                    </li>
                    <li>
                      <span className="font-semibold text-[var(--foreground)]">
                        Every value is the same
                      </span>{" "}
                      — the action is not set to &ldquo;use different values&rdquo;.
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
                      <span className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold text-white">
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
        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[14px] font-bold">Or upload a file yourself</p>
              <p className="mt-0.5 max-w-[58ch] text-[13.5px] text-[var(--muted)]">
                Same values, as a CSV in Google&apos;s import format. Use this if your
                account can&apos;t do scheduled uploads — you&apos;ll need to repeat it
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

        {/* ---- the next thing worth doing ---- */}
        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-white p-5">
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

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
          <p className="max-w-[56ch] text-[13px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">From here on:</span>{" "}
            re-run this with a fresh export when you want to send new leads. Your saved
            model keeps pricing them the same way until the data moves enough to justify
            refitting — and the report tells you when it has.
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
