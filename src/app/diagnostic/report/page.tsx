"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { ArrowIcon } from "@/components/ArrowIcon";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic } from "@/lib/analysis";
import { buildComparisons } from "@/lib/analysis/statedVsActual";
import { buildCohortValueCsv, downloadCsv } from "@/lib/export/googleAds";
import {
  CohortValueSection,
  CycleSection,
  DataQualitySection,
  DomainSection,
  SectionHead,
  ShadowRoasSection,
  SourceEconomicsSection,
  StatedVsActual,
  TrackingGapSection,
  ValueSpreadSection,
  VerdictBanner,
  money,
} from "@/components/report/sections";

export default function ReportPage() {
  const router = useRouter();
  const { file, fields, currency, businessContext, stageTiming } = useDiagnostic();
  const [conversionName, setConversionName] = useState("VBB Lead Value");
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (!file) router.replace("/diagnostic/upload");
  }, [file, router]);

  const result = useMemo(() => {
    if (!file) return null;
    const { deals, excluded } = rowsToDeals({ rows: file.rows, fields, currency, stageTiming });
    return runDiagnostic({
      deals,
      excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
    });
  }, [file, fields, currency, businessContext, stageTiming]);

  const comparisons = useMemo(() => {
    if (!result) return [];
    return buildComparisons(
      businessContext,
      result.cycle,
      result.volume,
      result.sources,
      result.cohortValues,
      result.icpFit
    ).comparisons;
  }, [result, businessContext]);

  if (!file || !result) return null;

  const cur = result.currencyCode;

  function handleDownload() {
    const csv = buildCohortValueCsv({
      cohorts: result!.cohortValues,
      conversionName,
      currencyCode: cur,
    });
    downloadCsv("vbb-cohort-values-google-ads.csv", csv);
    setDownloaded(true);
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="report" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {/* Header */}
        <div className="mb-7">
          <p className="label mb-2">Lead value diagnostic</p>
          <h1 className="text-[clamp(26px,3.6vw,34px)] font-bold leading-tight tracking-tight text-balance">
            What your leads are actually worth
          </h1>
          <p className="mono mt-2 text-[13px] text-[var(--muted)]">
            {result.rowsAnalyzed.toLocaleString()} deals analyzed · {file.name}
            {result.excluded.length > 0 &&
              ` · ${result.excluded.length.toLocaleString()} excluded`}
          </p>
        </div>

        <div className="grid gap-9">
          {/* 1 — Shadow ROAS, the opening shot */}
          <ShadowRoasSection
            rows={result.shadowRoas}
            currency={cur}
            blindnessRatio={result.valueSpread.blindnessRatio}
          />

          {/* 2 — Stated vs actual */}
          <StatedVsActual businessContext={businessContext} comparisons={comparisons} />

          {/* 3 — Verdict */}
          <VerdictBanner verdict={result.verdict} />

          {/* 4 — Tracking gap */}
          <TrackingGapSection match={result.matchRate} />

          {/* 5 — Evidence */}
          <CycleSection cycle={result.cycle} />
          <SourceEconomicsSection sources={result.sources} currency={cur} />
          <ValueSpreadSection spread={result.valueSpread} currency={cur} />
          <DomainSection domain={result.domainDisparity} currency={cur} />
          <DataQualitySection
            gate={result.earlyGate}
            trust={result.stageTrust}
            excluded={result.excluded}
          />

          {/* 6 — Cohort values */}
          <CohortValueSection
            cohorts={result.cohortValues}
            currency={cur}
            cap={result.valueSpread.recommendedCap}
          />

          {/* 7 — Export */}
          <section>
            <SectionHead title="Send these to Google Ads" />
            <div className="rounded-2xl border border-[var(--primary)]/30 bg-gradient-to-br from-[var(--primary-soft)] to-white p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <p className="max-w-[68ch] text-[14px] text-[var(--muted)]">
                    Exports your cohort table in Google&apos;s Click Conversion Import
                    format. Fill the Click ID column from your own lead export, then
                    upload it under Conversions → Uploads.
                  </p>
                  <label className="mt-4 block max-w-xs">
                    <span className="label">Conversion action name</span>
                    <input
                      className="input mono mt-1"
                      value={conversionName}
                      onChange={(e) => setConversionName(e.target.value)}
                    />
                    <span className="mt-1 block text-[11.5px] text-[var(--muted)]">
                      Must match the conversion action you created in Google Ads.
                    </span>
                  </label>
                </div>
                <button type="button" onClick={handleDownload} className="btn btn-primary">
                  {downloaded ? "Downloaded ✓" : "Download CSV"} <ArrowIcon />
                </button>
              </div>

              <div className="mt-5 grid gap-3 border-t border-[var(--primary)]/20 pt-5 sm:grid-cols-3">
                {[
                  { n: "1", t: "Download", d: "Your cohort values in Google's import format." },
                  { n: "2", t: "Import in Google Ads", d: "Conversions → Uploads → upload the file." },
                  { n: "3", t: "Smart Bidding adapts", d: "It optimizes toward revenue instead of form-fills." },
                ].map((s) => (
                  <div key={s.n} className="flex gap-3">
                    <span className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-[12px] font-bold text-white">
                      {s.n}
                    </span>
                    <div>
                      <p className="text-[13px] font-bold">{s.t}</p>
                      <p className="text-[12.5px] text-[var(--muted)]">{s.d}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <footer className="mt-10 border-t border-[var(--border)] pt-6">
          <p className="max-w-[78ch] text-[12.5px] text-[var(--muted)]">
            Every figure here is computed from the file you uploaded — cohort win rate ×
            median segment deal size, capped at{" "}
            {result.valueSpread.recommendedCap !== null
              ? money(result.valueSpread.recommendedCap, cur)
              : "the recommended cap"}
            . Nothing is estimated, benchmarked against other accounts, or forecast.
            These are descriptions of what already happened, not a performance guarantee.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => router.push("/diagnostic/mapping")}
              className="btn btn-secondary"
            >
              Back to mapping
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
