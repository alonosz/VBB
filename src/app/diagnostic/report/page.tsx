"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { FlowSkeleton } from "@/components/diagnostic/FlowSkeleton";
import { ArrowIcon } from "@/components/ArrowIcon";
import { PageHead } from "@/components/ui";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic, valueAllLeads, bestCaseStack, withOverrides } from "@/lib/analysis";
import { buildComparisons } from "@/lib/analysis/statedVsActual";
import { useSignalColumns } from "@/lib/diagnostic/useSignals";
import { describeSizeSelection, sizeFit } from "@/lib/analysis/statedProfile";
import {
  checkApplicability,
  compareToFresh,
  savedModelToValueModel,
  saveValueModel,
  type SavedValueModel,
} from "@/lib/model/savedModel";
import {
  downloadModel,
  forgetModel,
  modelFilename,
  readModelFile,
  recallModel,
  rememberModel,
} from "@/lib/model/storage";
import { ModelSourcePanel } from "@/components/report/modelSource";
import {
  AnalysisExpander,
  AttributionNote,
  ClaimsTestedSection,
  ClippedOutliersSection,
  EarlyGateSection,
  DroppedFactorsSection,
  RefusedColumnsSection,
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
  const {
    file, fields, currency, businessContext, stageTiming, intake,
    statedCycleDays, statedSizeBands, restored, audience, effectiveOutcomeOverrides: outcomeOverrides, modelSource, setModelSource } = useDiagnostic();
  const signals = useSignalColumns();

  // A saved model is the difference between a diagnostic and a daily loop: it
  // stops the same lead being worth two different amounts on two days. Recalled
  // during the first render rather than in an effect - this page renders
  // nothing until a file is in context, so there is no server output to mismatch.
  const [saved, setSaved] = useState<SavedValueModel | null>(() =>
    typeof window === "undefined" ? null : recallModel()
  );
  const [modelNotice, setModelNotice] = useState<string | null>(null);

  // Multipliers the user has typed over, keyed "factorKey::level". A marketer
  // who cannot argue with a number does not trust it.
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    // Wait for the saved snapshot to be read. Redirecting before it lands
    // would send someone who just refreshed back to the start, a frame before
    // their work reappears.
    if (restored && !file) router.replace("/diagnostic/upload");
  }, [restored, file, router]);

  // Claims from the intake step become factors to test, never values. The
  // engine still has to earn each one against the same thresholds.
  const { hypotheses, customSignalKeys } = signals;

  const mapped = useMemo(() => {
    if (!file) return null;
    return rowsToDeals({
      rows: file.rows,
      fields,
      currency,
      stageTiming,
      signalColumns: customSignalKeys,
      outcomeOverrides,
    });
  }, [file, fields, currency, stageTiming, customSignalKeys, outcomeOverrides]);

  const result = useMemo(() => {
    if (!mapped) return null;
    return runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
      customSignalKeys,
      hypotheses,
      audience,
    });
  }, [mapped, businessContext, currency.reportingCurrency, customSignalKeys, hypotheses, audience]);

  const applicability = useMemo(
    () =>
      saved && mapped
        ? checkApplicability(saved, mapped.deals, currency.reportingCurrency, audience)
        : null,
    [saved, mapped, currency.reportingCurrency, audience]
  );

  /*
   * What prices the leads. The saved model when it can price this file and
   * nobody has chosen otherwise; a fresh fit when there is no saved model,
   * when the advertiser picked the fresh fit, or when the saved model cannot
   * read this file at all. That last case used to be the default: a business
   * model remembered from last week priced a consumer file at one flat value
   * and the report presented it as the model in use.
   */
  const usable = !!saved && !applicability?.unusableBecause;
  const source: "fresh" | "saved" = usable && modelSource !== "fresh" ? "saved" : "fresh";

  // What actually prices the leads: the frozen model when one is in use,
  // otherwise today's fit.
  const activeModel = useMemo(() => {
    if (!result) return null;
    const base = source === "saved" && saved ? savedModelToValueModel(saved) : result.valueModel;
    // Editing a multiplier without redoing calibration would quietly break the
    // promise that emitted values average back to what the data shows.
    return mapped ? withOverrides(base, mapped.deals, overrides) : base;
  }, [result, source, saved, mapped, overrides]);

  const valued = useMemo(() => {
    if (!mapped || !activeModel) return [];
    return valueAllLeads(mapped.deals, activeModel, overrides);
  }, [mapped, activeModel, overrides]);

  // Never applied automatically - it only answers whether the saved rules still
  // describe the business.
  const drift = useMemo(
    () => (result && saved ? compareToFresh(saved, result.valueModel) : null),
    [result, saved]
  );


  const comparisons = useMemo(() => {
    if (!result) return [];
    const p = intake?.status === "ready" ? intake.proposal : null;
    return buildComparisons(
      businessContext,
      result.cycle,
      result.volume,
      result.sources,
      result.icpFit,
      p
        ? {
            cycleDaysMin: p.statedCycleDaysMin,
            cycleDaysMax: p.statedCycleDaysMax,
            leadsPerMonthMin: p.statedLeadsPerMonthMin,
            leadsPerMonthMax: p.statedLeadsPerMonthMax,
            namedSources: p.statedSources,
          }
        : undefined,
      {
        cycleDays: statedCycleDays,
        // A consumer was never asked for a headcount, so there is no claim
        // to hold against the data.
        sizeLabel: audience === "b2c" ? "" : describeSizeSelection(statedSizeBands),
        sizeFit: mapped && audience !== "b2c" ? sizeFit(mapped.deals, statedSizeBands) : undefined,
      }
    ).comparisons;
  }, [result, businessContext, intake, statedCycleDays, statedSizeBands, mapped, audience]);

  // Same markup on the server and during hydration; the restored flow only
  // exists in the browser and appears on the pass after.
  if (!restored) return <FlowSkeleton />;
  if (!file || !result || !mapped || !activeModel) return null;

  const cur = result.currencyCode;
  const stack = bestCaseStack(activeModel, overrides);


  // Spread of examples across the value range, so the table shows the model
  // working rather than eight near-identical leads.
  const examples = (() => {
    const sorted = [...valued].filter((v) => v.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length <= 8) return sorted;
    const step = (sorted.length - 1) / 7;
    return Array.from({ length: 8 }, (_, i) => sorted[Math.round(i * step)]);
  })();


  function handleOverride(key: string, value: number | null) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function handleSaveModel() {
    if (!mapped) return;
    const s = saveValueModel(
      withOverrides(result!.valueModel, mapped.deals, overrides),
      { deals: mapped.deals, overrides }
    );
    rememberModel(s);
    downloadModel(s);
    setSaved(s);
    setModelSource("saved");
    setModelNotice(`Saved as ${modelFilename(s)} and remembered in this browser.`);
  }

  async function handleLoadModel(f: File) {
    const { model, error } = await readModelFile(f);
    if (!model) {
      setModelNotice(error);
      return;
    }
    rememberModel(model);
    setSaved(model);
    setModelSource("saved");
    setModelNotice(`Loaded the model fitted on ${model.fittedAt.slice(0, 10)}.`);
  }


  function handleForgetModel() {
    forgetModel();
    setSaved(null);
    setModelSource(null);
    setModelNotice("Saved model forgotten. These leads are priced on a fresh fit.");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Stepper current="report" />

      <main className="page animate-page-in flex-1 py-10">
        {/* No action here. The bar pinned to the bottom of the viewport carries
            it for the whole page, so a second copy at the top is the same
            button twice on one screen. */}
        <PageHead
          eyebrow="Step 4 of 5 · Your model"
          title="This is what a lead is worth to you"
          lede="Every figure below is an estimate from the file you uploaded: how often each kind of lead closed, times the average amount it closed for, with outliers capped. Nothing is benchmarked against other accounts."
        />

        <CountsBreakdown
          fileName={file.name}
          imported={file.rows.length}
          analysed={result.rowsAnalyzed}
          excluded={result.excluded}
          resolved={result.valueModel.fittedOn}
          priced={valued.filter((v) => v.value > 0).length}
          matchable={result.matchRate.withAnyIdentifier}
        />

        {/* minmax(0,1fr) rather than the default auto: a grid item will not shrink
            below its min-content, so one wide table inside any panel would push
            the whole page sideways on a phone. */}
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-7">
          <HookPanel
            spread={result.valueSpread}
            valued={valued}
            currency={cur}
            flat={activeModel.isFlat}
            onFixSignals={() => router.push("/diagnostic/mapping")}
          />

          <ModelSourcePanel
            saved={saved}
            active={source}
            drift={drift}
            inert={applicability?.inert ?? []}
            currencyMismatch={applicability?.currencyMismatch ?? null}
            unusableBecause={applicability?.unusableBecause ?? null}
            freshFittedOn={result.valueModel.fittedOn}
            onSave={handleSaveModel}
            onLoadFile={handleLoadModel}
            onUse={setModelSource}
            onForget={handleForgetModel}
            notice={modelNotice}
          />

          <ValueModelPanel
            model={activeModel}
            stack={stack}
            spread={result.valueSpread}
            examples={examples}
            currency={cur}
            overrides={overrides}
            onOverride={handleOverride}
            onResetAll={() => setOverrides({})}
          />

          <ClaimsTestedSection model={result.valueModel} />

          <EarlyGateSection gate={result.gate} currency={cur} />

          <WiringPanel
            match={result.matchRate}
            volume={result.volume}
            verdict={result.verdict}
            onContinue={() => router.push("/diagnostic/connect")}
          />

          <AnalysisExpander>
            <AttributionNote />
            <StatedVsActual businessContext={businessContext} comparisons={comparisons} />
            <CycleSection cycle={result.cycle} />
            <section>
              <SectionHead
                title="Channel insight - not used to price leads"
                note="For your own budget decisions"
              >
                <p className="mt-1 max-w-[70ch] text-[13.5px] text-[var(--muted)]">
                  Attribution labels don&apos;t change what an individual ad click is
                  worth, and Google already knows which campaign produced it. How each
                  source performs is still worth knowing for where you put budget.
                </p>
              </SectionHead>
              <SourceEconomicsSection sources={result.sources} currency={cur} />
            </section>
            <DroppedFactorsSection model={result.valueModel} />
            <RefusedColumnsSection refused={signals.refused} />
            <ClippedOutliersSection
              deals={mapped.deals}
              valued={valued}
              spread={result.valueSpread}
              currency={cur}
            />
            <DataQualitySection
              gate={result.earlyGate}
              trust={result.stageTrust}
              excluded={result.excluded}
            />
          </AnalysisExpander>
        </div>

        {/* The report runs several screens deep and the action that leaves it
            was at the very bottom of all of them. It follows you down now, the
            same way the mapping screen's does. */}
        <footer className="sticky bottom-0 z-20 -mx-5 mt-12 flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-5 py-3.5 backdrop-blur-md md:-mx-8 md:gap-4 md:px-8 md:py-4">
          {/* One row on a phone. Two stacked full-width buttons in a pinned bar
              eat a third of the screen, and the bar is there for the whole
              scroll. Both labels shorten rather than wrap. */}
          <button
            type="button"
            onClick={() => router.push("/diagnostic/mapping")}
            className="btn btn-secondary shrink-0"
          >
            <span className="sm:hidden">Back</span>
            <span className="hidden sm:inline">Back to mapping</span>
          </button>
          <button
            type="button"
            onClick={() => router.push("/diagnostic/connect")}
            className="btn btn-primary min-w-0"
          >
            <span className="truncate">
              <span className="sm:hidden">Review &amp; connect</span>
              <span className="hidden sm:inline">Review &amp; connect to Google Ads</span>
            </span>
            <ArrowIcon />
          </button>
        </footer>
      </main>
    </div>
  );
}

/**
 * The four counts a report shows, side by side with why they differ.
 *
 * Imported, analysed, resolved, priced and matchable are all correct and all
 * different, and a reader who cannot see why stops trusting the one that
 * matters. So they sit in one row, each with a word for what it is, and the
 * exclusion reasons open underneath.
 */
function CountsBreakdown({
  fileName,
  imported,
  analysed,
  excluded,
  resolved,
  priced,
  matchable,
}: {
  fileName: string;
  imported: number;
  analysed: number;
  excluded: { id: string; reason: string }[];
  resolved: number;
  priced: number;
  matchable: number;
}) {
  const reasons = new Map<string, number>();
  for (const e of excluded) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);

  const items: { label: string; value: number; means: string }[] = [
    { label: "Imported", value: imported, means: "rows in the file" },
    { label: "Analysed", value: analysed, means: "rows with the columns the analysis needs" },
    { label: "Resolved", value: resolved, means: "won or lost, the rows the model is fitted on" },
    { label: "Priced", value: priced, means: "leads the model gave a value to" },
    { label: "Matchable", value: matchable, means: "priced leads carrying a click ID or email Google can match" },
  ];

  return (
    <details className="group mt-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--muted)] [&::-webkit-details-marker]:hidden">
        {items.map((item, i) => (
          <span key={item.label} className="flex items-center gap-x-4">
            {i > 0 && <span aria-hidden className="text-[var(--border-strong)]">·</span>}
            <span>
              <span className="mono font-semibold text-[var(--foreground)]">{item.value.toLocaleString()}</span>{" "}
              {item.label.toLowerCase()}
            </span>
          </span>
        ))}
        <span className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
          <span className="group-open:hidden">Why they differ</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="card mt-3 p-4 text-[13px]">
        <p className="mono mb-2 text-[12px] text-[var(--muted)]">{fileName}</p>
        <ul className="grid gap-1.5">
          {items.map((item) => (
            <li key={item.label} className="flex flex-wrap gap-x-2">
              <span className="mono w-[6ch] shrink-0 text-right font-semibold">{item.value.toLocaleString()}</span>
              <span className="font-semibold">{item.label}</span>
              <span className="text-[var(--muted)]">{item.means}</span>
            </li>
          ))}
        </ul>
        {reasons.size > 0 && (
          <ul className="mt-3 grid gap-1 border-t border-[var(--border)] pt-3 text-[var(--muted)]">
            {[...reasons.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <li key={reason}>
                  <span className="mono font-semibold text-[var(--foreground)]">{count.toLocaleString()}</span> excluded: {reason}
                </li>
              ))}
          </ul>
        )}
      </div>
    </details>
  );
}
