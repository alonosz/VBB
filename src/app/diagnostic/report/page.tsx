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
import { resolveHypotheses } from "@/lib/intake/merge";
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
    statedCycleDays, statedSizeBands, restored } = useDiagnostic();

  // A saved model is the difference between a diagnostic and a daily loop: it
  // stops the same lead being worth two different amounts on two days. Recalled
  // during the first render rather than in an effect — this page renders
  // nothing until a file is in context, so there is no server output to mismatch.
  const [saved, setSaved] = useState<SavedValueModel | null>(() =>
    typeof window === "undefined" ? null : recallModel()
  );
  const [source, setSource] = useState<"fresh" | "saved">(saved ? "saved" : "fresh");
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
  const { hypotheses, customSignalKeys } = useMemo(
    () =>
      intake?.status === "ready"
        ? resolveHypotheses(intake.proposal, fields)
        : { hypotheses: [], customSignalKeys: [] },
    [intake, fields]
  );

  const mapped = useMemo(() => {
    if (!file) return null;
    return rowsToDeals({
      rows: file.rows,
      fields,
      currency,
      stageTiming,
      signalColumns: customSignalKeys,
    });
  }, [file, fields, currency, stageTiming, customSignalKeys]);

  const result = useMemo(() => {
    if (!mapped) return null;
    return runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
      customSignalKeys,
      hypotheses,
    });
  }, [mapped, businessContext, currency.reportingCurrency, customSignalKeys, hypotheses]);

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

  // Never applied automatically — it only answers whether the saved rules still
  // describe the business.
  const drift = useMemo(
    () => (result && saved ? compareToFresh(saved, result.valueModel) : null),
    [result, saved]
  );

  const applicability = useMemo(
    () =>
      saved && mapped
        ? checkApplicability(saved, mapped.deals, currency.reportingCurrency)
        : null,
    [saved, mapped, currency.reportingCurrency]
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
        sizeLabel: describeSizeSelection(statedSizeBands),
        sizeFit: mapped ? sizeFit(mapped.deals, statedSizeBands) : undefined,
      }
    ).comparisons;
  }, [result, businessContext, intake, statedCycleDays, statedSizeBands, mapped]);

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
    setSource("saved");
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
    setSource("saved");
    setModelNotice(`Loaded the model fitted on ${model.fittedAt.slice(0, 10)}.`);
  }


  function handleForgetModel() {
    forgetModel();
    setSaved(null);
    setSource("fresh");
    setModelNotice("Saved model forgotten. These leads are priced on a fresh fit.");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Stepper current="report" />

      <main className="page animate-page-in flex-1 py-10">
        <PageHead
          eyebrow={
            <>
              Step 4 of 5 · Your model
            </>
          }
          title="This is what a lead is worth to you"
          lede={
            <>
              Every figure below is computed from the file you uploaded — cohort
              win rate against your own median deal size. Nothing is estimated
              or benchmarked against other accounts.
            </>
          }
          action={
            /* The action belongs where the page starts, not two screens down.
               Someone who already trusts the model should never have to scroll
               past the whole analysis to act on it. */
            <button
              type="button"
              onClick={() => router.push("/diagnostic/connect")}
              className="btn btn-primary btn-lg w-full justify-center sm:w-auto"
            >
              Send these values to Google Ads <ArrowIcon />
            </button>
          }
        />

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="mono text-[12.5px] text-[var(--muted)]">
            {result.rowsAnalyzed.toLocaleString()} deals analysed
          </span>
          <span aria-hidden className="text-[var(--border-strong)]">·</span>
          <span className="mono max-w-[28ch] truncate text-[12.5px] text-[var(--muted)]" title={file.name}>
            {file.name}
          </span>
          {result.excluded.length > 0 && (
            <>
              <span aria-hidden className="text-[var(--border-strong)]">·</span>
              <span className="mono text-[12.5px] text-[var(--warn)]">
                {result.excluded.length.toLocaleString()} excluded
              </span>
            </>
          )}
        </div>

        {/* minmax(0,1fr) rather than the default auto: a grid item will not shrink
            below its min-content, so one wide table inside any panel would push
            the whole page sideways on a phone. */}
        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-7">
          <HookPanel spread={result.valueSpread} valued={valued} currency={cur} />

          <ModelSourcePanel
            saved={saved}
            active={source}
            drift={drift}
            inert={applicability?.inert ?? []}
            currencyMismatch={applicability?.currencyMismatch ?? null}
            freshFittedOn={result.valueModel.fittedOn}
            onSave={handleSaveModel}
            onLoadFile={handleLoadModel}
            onUse={setSource}
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
            <ClaimsTestedSection model={result.valueModel} />
            <CycleSection cycle={result.cycle} />
            <section>
              <SectionHead
                title="Channel insight — not used to price leads"
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

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
          <button
            type="button"
            onClick={() => router.push("/diagnostic/mapping")}
            className="btn btn-secondary"
          >
            Back to mapping
          </button>
          <button
            type="button"
            onClick={() => router.push("/diagnostic/connect")}
            className="btn btn-primary"
          >
            Send these values to Google Ads <ArrowIcon />
          </button>
        </footer>
      </main>
    </div>
  );
}
