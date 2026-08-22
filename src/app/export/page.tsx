"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/context/AppStateContext";
import { StepHeader } from "@/components/StepHeader";
import { computeModelScores } from "@/lib/scoring";
import { buildGenericCsv, buildGoogleAdsCsv } from "@/lib/exportCsv";
import { downloadTextFile } from "@/lib/csv";
import type { MatchType } from "@/lib/types";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "BRL", "MXN", "NZD"];

function guessDateColumn(headers: string[]): string | null {
  const idx = headers.findIndex((h) => /date|time/i.test(h));
  return idx !== -1 ? headers[idx] : null;
}

export default function ExportPage() {
  const router = useRouter();
  const { csvData, model, matchConfig, setMatchConfig, exportConfig, setExportConfig } =
    useAppState();

  const [gAdsResult, setGAdsResult] = useState<{ included: number; skipped: number } | null>(
    null
  );
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!csvData) {
      router.replace("/upload");
      return;
    }
    if (!model || model.blocks.filter((b) => b.enabled).length === 0) {
      router.replace("/build");
    }
  }, [csvData, model, router]);

  useEffect(() => {
    if (csvData && !exportConfig.conversionTimeColumn) {
      const guess = guessDateColumn(csvData.headers);
      if (guess) setExportConfig({ ...exportConfig, conversionTimeColumn: guess });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvData]);

  const scored = useMemo(() => {
    if (!csvData || !model) return [];
    return computeModelScores(csvData.rows, model, matchConfig.column);
  }, [csvData, model, matchConfig.column]);

  if (!csvData || !model) return null;

  async function handleGoogleAdsExport() {
    setGenerating(true);
    setGAdsResult(null);
    try {
      const result = await buildGoogleAdsCsv(scored, matchConfig, exportConfig);
      downloadTextFile(
        `${(model!.name || "leads").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-google-ads-conversions.csv`,
        result.csv,
        "text/csv"
      );
      setGAdsResult({ included: result.includedCount, skipped: result.skippedCount });
    } finally {
      setGenerating(false);
    }
  }

  function handleGenericExport() {
    const csv = buildGenericCsv(csvData!.headers, scored);
    downloadTextFile(
      `${(model!.name || "leads").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-scored.csv`,
      csv,
      "text/csv"
    );
  }

  const readyForGoogleAds = !!matchConfig.column && !!exportConfig.conversionTimeColumn;

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <StepHeader current="export" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Export</h1>
        <p className="mt-1 text-sm text-[#6b6d85]">
          Download your scored data, formatted for how you plan to use it.
        </p>

        <div className="card mt-6 p-6">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <p className="text-sm font-semibold">Google Ads offline conversion import</p>
          </div>
          <p className="mt-1 text-xs text-[#8688a0]">
            Matches Google&apos;s Click Conversion Import CSV format so you can
            upload it directly in Google Ads.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Match field</label>
              <select
                className="input mt-1"
                value={matchConfig.column ?? ""}
                onChange={(e) =>
                  setMatchConfig({ ...matchConfig, column: e.target.value || null })
                }
              >
                <option value="">Select a column…</option>
                {csvData.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Match type</label>
              <div className="mt-1 flex overflow-hidden rounded-lg border border-[var(--border)]">
                {(["email", "gclid"] as MatchType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMatchConfig({ ...matchConfig, type: t })}
                    className={
                      "flex-1 px-3 py-1.5 text-xs font-semibold transition-colors " +
                      (matchConfig.type === t
                        ? "bg-[var(--primary)] text-white"
                        : "bg-white text-[#6b6d85] hover:bg-[#f3f3f8]")
                    }
                  >
                    {t === "email" ? "Email (hashed)" : "Google Click ID"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Conversion time column</label>
              <select
                className="input mt-1"
                value={exportConfig.conversionTimeColumn ?? ""}
                onChange={(e) =>
                  setExportConfig({
                    ...exportConfig,
                    conversionTimeColumn: e.target.value || null,
                  })
                }
              >
                <option value="">Select a column…</option>
                {csvData.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Conversion name</label>
              <input
                className="input mt-1"
                value={exportConfig.conversionName}
                onChange={(e) =>
                  setExportConfig({ ...exportConfig, conversionName: e.target.value })
                }
              />
            </div>
            <div>
              <label className="label">Currency</label>
              <select
                className="input mt-1"
                value={exportConfig.currencyCode}
                onChange={(e) =>
                  setExportConfig({ ...exportConfig, currencyCode: e.target.value })
                }
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Value at a score of 100</label>
              <input
                type="number"
                min={0}
                step={0.01}
                className="input mt-1"
                value={exportConfig.maxConversionValue}
                onChange={(e) =>
                  setExportConfig({
                    ...exportConfig,
                    maxConversionValue: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          {!readyForGoogleAds && (
            <p className="mt-3 text-xs text-[var(--warn)]">
              Select a match field and conversion time column to enable this export.
            </p>
          )}

          <button
            type="button"
            disabled={!readyForGoogleAds || generating}
            onClick={handleGoogleAdsExport}
            className="btn btn-primary mt-4 w-full justify-center"
          >
            {generating ? "Generating…" : "⬇ Download Google Ads conversion CSV"}
          </button>

          {gAdsResult && (
            <p className="mt-2 text-xs text-[#6b6d85]">
              Included {gAdsResult.included.toLocaleString()} row(s)
              {gAdsResult.skipped > 0 &&
                ` · skipped ${gAdsResult.skipped.toLocaleString()} (missing match field or conversion time)`}
              .
            </p>
          )}

          <p className="mt-3 rounded-lg bg-[var(--primary-soft)] px-3 py-2 text-xs text-[#4a3cf0]">
            Re-run this exact model anytime — just load your saved model file
            and upload new data.
          </p>
        </div>

        <div className="card mt-5 p-6">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <p className="text-sm font-semibold">Generic scored CSV</p>
          </div>
          <p className="mt-1 text-xs text-[#8688a0]">
            Your original columns plus Score and Tier — for your own records
            or to import into any other platform.
          </p>
          <button
            type="button"
            onClick={handleGenericExport}
            className="btn btn-secondary mt-4 w-full justify-center"
          >
            ⬇ Download scored CSV
          </button>
        </div>

        <div className="mt-6 flex justify-start">
          <button type="button" onClick={() => router.push("/results")} className="btn btn-secondary">
            ← Back to results
          </button>
        </div>
      </main>
    </div>
  );
}
