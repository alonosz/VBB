"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic, valueAllLeads, bestCaseStack } from "@/lib/analysis";
import { buildComparisons } from "@/lib/analysis/statedVsActual";
import { buildValueModelCsv, downloadCsv } from "@/lib/export/googleAds";
import {
  AnalysisExpander,
  AttributionNote,
  DroppedFactorsSection,
  HookPanel,
  ValueModelPanel,
  WiringPanel,
} from "@/components/report/panels";
import {
  CycleSection,
  DataQualitySection,
  SectionHead,
  SourceEconomicsSection,
  StatedVsActual,
} from "@/components/report/sections";

export default function ReportPage() {
  const router = useRouter();
  const { file, fields, currency, businessContext, stageTiming } = useDiagnostic();
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    if (!file) router.replace("/diagnostic/upload");
  }, [file, router]);

  const mapped = useMemo(() => {
    if (!file) return null;
    return rowsToDeals({ rows: file.rows, fields, currency, stageTiming });
  }, [file, fields, currency, stageTiming]);

  const result = useMemo(() => {
    if (!mapped) return null;
    return runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
    });
  }, [mapped, businessContext, currency.reportingCurrency]);

  const valued = useMemo(() => {
    if (!mapped || !result) return [];
    return valueAllLeads(mapped.deals, result.valueModel);
  }, [mapped, result]);

  const comparisons = useMemo(() => {
    if (!result) return [];
    return buildComparisons(
      businessContext,
      result.cycle,
      result.volume,
      result.sources,
      result.icpFit
    ).comparisons;
  }, [result, businessContext]);

  if (!file || !result || !mapped) return null;

  const cur = result.currencyCode;
  const stack = bestCaseStack(result.valueModel);

  // Prefer whichever identifier actually covers more leads. A click ID matches
  // directly; a hashed email relies on Google finding the click itself.
  const matchIdentifier: "clickId" | "email" =
    result.matchRate.withClickId >= result.matchRate.withValidEmail ? "clickId" : "email";

  // Spread of examples across the value range, so the table shows the model
  // working rather than eight near-identical leads.
  const examples = (() => {
    const sorted = [...valued].filter((v) => v.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length <= 8) return sorted;
    const step = (sorted.length - 1) / 7;
    return Array.from({ length: 8 }, (_, i) => sorted[Math.round(i * step)]);
  })();

  async function handleExport() {
    const r = await buildValueModelCsv({
      leads: valued,
      conversionName: "VBB Lead Value",
      currencyCode: cur,
      identifier: matchIdentifier,
    });
    downloadCsv("vbb-lead-values-google-ads.csv", r.csv);
    setExportNote(
      `${r.included.toLocaleString()} conversion${r.included === 1 ? "" : "s"} written` +
        (r.skippedReason ? ` · ${r.skippedReason}` : "")
    );
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="report" />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-7">
          <p className="mono text-[13px] text-[var(--muted)]">
            {result.rowsAnalyzed.toLocaleString()} deals · {file.name}
            {result.excluded.length > 0 &&
              ` · ${result.excluded.length.toLocaleString()} excluded`}
          </p>
        </div>

        <div className="grid gap-8">
          <HookPanel spread={result.valueSpread} valued={valued} currency={cur} />

          <ValueModelPanel
            model={result.valueModel}
            stack={stack}
            spread={result.valueSpread}
            examples={examples}
            currency={cur}
          />

          <WiringPanel
            match={result.matchRate}
            volume={result.volume}
            verdict={result.verdict}
            onExport={handleExport}
            exportLabel={`Download ${matchIdentifier === "clickId" ? "click-ID" : "hashed-email"} conversions`}
            exportNote={exportNote}
          >
            <span className="text-[12.5px] text-[var(--muted)]">
              Google&apos;s Click Conversion Import format · one row per lead
            </span>
          </WiringPanel>

          <AnalysisExpander>
            <AttributionNote />
            <StatedVsActual businessContext={businessContext} comparisons={comparisons} />
            <CycleSection cycle={result.cycle} />
            <section>
              <SectionHead
                title="Channel insight — not used in your value model"
                note="For your own budget decisions"
              >
                <p className="mt-1 max-w-[70ch] text-[13.5px] text-[var(--muted)]">
                  How each source performs is worth knowing, but it does not price a
                  lead here. Google already knows which campaign produced the click.
                </p>
              </SectionHead>
              <SourceEconomicsSection sources={result.sources} currency={cur} />
            </section>
            <DroppedFactorsSection model={result.valueModel} />
            <DataQualitySection
              gate={result.earlyGate}
              trust={result.stageTrust}
              excluded={result.excluded}
            />
          </AnalysisExpander>
        </div>

        <footer className="mt-10 border-t border-[var(--border)] pt-6">
          <p className="max-w-[78ch] text-[12.5px] text-[var(--muted)]">
            Every figure here is computed from the file you uploaded. Nothing is
            estimated, benchmarked against other accounts, or forecast.
          </p>
          <button
            type="button"
            onClick={() => router.push("/diagnostic/mapping")}
            className="btn btn-secondary mt-4"
          >
            Back to mapping
          </button>
        </footer>
      </main>
    </div>
  );
}
