"use client";

import { useMemo } from "react";
import type { CsvData, ModelConfig } from "@/lib/types";
import { computeDatasetStats, scoreRow } from "@/lib/scoring";
import { TierBadge } from "@/components/TierBadge";

const SAMPLE_SIZE = 6;

export function LivePreviewPanel({
  csvData,
  model,
}: {
  csvData: CsvData;
  model: ModelConfig;
}) {
  const sample = useMemo(
    () => csvData.rows.slice(0, SAMPLE_SIZE),
    [csvData.rows]
  );

  const previewCols = useMemo(() => csvData.headers.slice(0, 2), [csvData.headers]);

  const scored = useMemo(() => {
    const stats = computeDatasetStats(csvData.rows, model.blocks);
    return sample.map((row) => {
      const { score } = scoreRow(row, model, stats);
      return { row, score };
    });
  }, [sample, model, csvData.rows]);

  const activeBlockCount = model.blocks.filter((b) => b.enabled).length;

  return (
    <div className="card sticky top-[130px] flex max-h-[calc(100vh-160px)] flex-col overflow-hidden">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <p className="text-sm font-semibold">Live preview</p>
        <p className="text-xs text-[#8688a0]">
          {activeBlockCount === 0
            ? "Add a rule block to see scores appear."
            : `Scoring ${sample.length} of ${csvData.rowCount.toLocaleString()} rows as you build`}
        </p>
      </div>
      <div className="flex-1 divide-y divide-[var(--border)] overflow-y-auto">
        {scored.map(({ row, score }, i) => (
          <div key={i} className="px-4 py-3 transition-colors">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-[#33344a]">
                {previewCols.map((c) => row[c]).filter(Boolean).join(" · ") ||
                  `Row ${i + 1}`}
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums">{score}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eceeF7]">
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-all duration-300 ease-out"
                  style={{ width: `${score}%` }}
                />
              </div>
              <TierBadge
                tier={score >= 70 ? "High" : score >= 40 ? "Medium" : "Low"}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
