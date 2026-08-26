"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { ArrowIcon } from "@/components/ArrowIcon";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic, valueAllLeads, withOverrides } from "@/lib/analysis";
import { resolveHypotheses } from "@/lib/intake/merge";
import { savedModelToValueModel } from "@/lib/model/savedModel";
import { recallModel } from "@/lib/model/storage";
import { buildValueModelCsv, downloadCsv } from "@/lib/export/googleAds";
import { bestIdentifier, buildFeedRows } from "@/lib/feed/publish";
import { money } from "@/components/report/panels";

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
}

const GOOGLE_STEPS = [
  {
    title: "Open your conversion uploads",
    body: "In Google Ads: Tools & Settings → Measurement → Conversions → the Uploads tab.",
  },
  {
    title: "Add a schedule",
    body: "Open the Schedules tab, click +, and choose HTTPS as the source.",
  },
  {
    title: "Paste your feed URL",
    body: "Then pick how often Google fetches it. Daily suits most accounts; twice daily if leads arrive around the clock.",
  },
  {
    title: "Preview, then save",
    body: "Preview shows Google reading your file — one row per lead, each with its own value. Save, and nobody touches a file again.",
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

  const valued = useMemo(() => {
    if (!mapped) return [];
    const result = runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
      customSignalKeys,
      hypotheses,
    });
    const model = saved ? savedModelToValueModel(saved) : result.valueModel;
    return valueAllLeads(mapped.deals, withOverrides(model, mapped.deals, {}));
  }, [mapped, businessContext, currency.reportingCurrency, customSignalKeys, hypotheses, saved]);

  if (!file || !mapped) return null;

  const cur = currency.reportingCurrency;
  const priced = valued.filter((v) => v.value > 0);
  const values = priced.map((v) => v.value).sort((a, b) => a - b);
  const modelId = saved?.modelId ?? `fresh-${new Date().toISOString().slice(0, 10)}`;

  async function publish() {
    if (!mapped) return;
    setPublishing(true);
    setError(null);
    try {
      const identifier = bestIdentifier(valued);
      const { rows, skipped } = await buildFeedRows({
        leads: valued,
        modelId,
        currencyCode: cur,
        identifier,
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
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(data.error ?? "The feed could not be published.");
      else setFeed({ feedUrl: data.feedUrl, rowsPublished: data.rowsPublished, identifier: data.identifier });
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
                <p className="mt-2.5 max-w-[70ch] text-[12.5px] text-[var(--muted)]">
                  <span className="font-semibold text-[var(--warn)]">Copy it now.</span>{" "}
                  The key is stored only as a hash, so we can&apos;t show it again — and
                  anyone holding it can read the feed.
                </p>
              </div>

              <div className="mt-5 border-t border-[var(--border)] pt-5">
                <p className="text-[14px] font-bold">Where it goes in Google Ads</p>
                <ol className="mt-3 grid gap-3">
                  {GOOGLE_STEPS.map((step, i) => (
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
