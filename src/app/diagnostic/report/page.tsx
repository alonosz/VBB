"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic, valueAllLeads, bestCaseStack, withOverrides } from "@/lib/analysis";
import { buildComparisons } from "@/lib/analysis/statedVsActual";
import { buildValueModelCsv, downloadCsv } from "@/lib/export/googleAds";
import { resolveHypotheses } from "@/lib/intake/merge";
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
import { FeedSection, type PublishedFeed } from "@/components/report/feedPanel";
import { buildFeedRows, bestIdentifier } from "@/lib/feed/publish";
import {
  AnalysisExpander,
  AttributionNote,
  ClaimsTestedSection,
  ClippedOutliersSection,
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
  const { file, fields, currency, businessContext, stageTiming, intake } = useDiagnostic();
  const [exportNote, setExportNote] = useState<string | null>(null);

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

  // Publishing turns the model on screen into a URL Google fetches by itself.
  const [feed, setFeed] = useState<PublishedFeed | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) router.replace("/diagnostic/upload");
  }, [file, router]);

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
        : undefined
    ).comparisons;
  }, [result, businessContext, intake]);

  if (!file || !result || !mapped || !activeModel) return null;

  const cur = result.currencyCode;
  const stack = bestCaseStack(activeModel, overrides);

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
        // Which model produced these numbers is part of the record.
        (source === "saved" && saved
          ? ` · priced by your model saved ${saved.fittedAt.slice(0, 10)}`
          : " · priced by a fresh fit on this file") +
        (r.skippedReason ? ` · ${r.skippedReason}` : "")
    );
  }

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

  async function handlePublishFeed() {
    if (!mapped) return;
    setPublishing(true);
    setFeedError(null);
    try {
      const identifier = bestIdentifier(valued);
      // The rows are built here, from the model on screen. The server cannot
      // price anything — it never sees the CRM data.
      const { rows, skipped } = await buildFeedRows({
        leads: valued,
        modelId: saved?.modelId ?? `fresh-${new Date().toISOString().slice(0, 10)}`,
        currencyCode: cur,
        identifier,
      });

      if (rows.length === 0) {
        setFeedError(
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
          modelId: saved?.modelId ?? `fresh-${new Date().toISOString().slice(0, 10)}`,
          modelFittedAt: saved?.fittedAt ?? null,
          currencyCode: cur,
          identifier,
          rows: rows.map((r) => ({
            ...r,
            conversionTime: r.conversionTime.toISOString(),
          })),
        }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string } & PublishedFeed;
      if (!res.ok || !data.ok) {
        setFeedError(data.error ?? "The feed could not be published.");
        return;
      }
      setFeed({
        feedUrl: data.feedUrl,
        rowsPublished: data.rowsPublished,
        identifier: data.identifier,
      });
    } catch {
      setFeedError("The feed could not be published. Nothing was sent.");
    } finally {
      setPublishing(false);
    }
  }

  function handleForgetModel() {
    forgetModel();
    setSaved(null);
    setSource("fresh");
    setModelNotice("Saved model forgotten. These leads are priced on a fresh fit.");
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

          <WiringPanel
            match={result.matchRate}
            volume={result.volume}
            verdict={result.verdict}
            onExport={handleExport}
            exportLabel={`Download ${matchIdentifier === "clickId" ? "click-ID" : "hashed-email"} conversions`}
            exportNote={exportNote}
            footer={
              <FeedSection
                published={feed}
                publishing={publishing}
                error={feedError}
                onPublish={handlePublishFeed}
                summary="Or let Google fetch them itself, on a schedule — no file to upload again."
              />
            }
          >
            <span className="text-[12.5px] text-[var(--muted)]">
              Google&apos;s Click Conversion Import format · one row per lead
            </span>
          </WiringPanel>

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
