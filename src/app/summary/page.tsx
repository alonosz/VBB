"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/context/AppStateContext";
import { StepHeader } from "@/components/StepHeader";
import { buildSummaryLines, composeSummarySentence, RULE_TYPE_META } from "@/lib/summary";
import { downloadTextFile } from "@/lib/csv";
import { modelFileName, serializeModel } from "@/lib/modelIO";
import { ArrowIcon } from "@/components/ArrowIcon";

export default function SummaryPage() {
  const router = useRouter();
  const { csvData, model, setModel } = useAppState();
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (!csvData) {
      router.replace("/upload");
      return;
    }
    if (!model || model.blocks.filter((b) => b.enabled).length === 0) {
      router.replace("/build");
    }
  }, [csvData, model, router]);

  if (!csvData || !model) return null;

  const lines = buildSummaryLines(model);
  const sentence = composeSummarySentence(model);
  const name = model.name.trim() || "Untitled Model";

  function handleDownload() {
    const finalModel = { ...model!, name };
    setModel(finalModel);
    downloadTextFile(
      modelFileName(finalModel),
      serializeModel(finalModel),
      "application/json"
    );
    setDownloaded(true);
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <StepHeader current="summary" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Model summary</h1>
        <p className="mt-1 text-sm text-[#6b6d85]">
          Review your model in plain English, name it, and save it so you can
          reuse it on new data later — no rebuilding required.
        </p>

        <div className="card mt-6 p-6">
          <label className="label">Model name</label>
          <input
            className="input mt-1.5 text-base font-semibold"
            placeholder="e.g. Q1 2026 Lead Score Model"
            value={model.name}
            onChange={(e) => setModel({ ...model, name: e.target.value })}
          />

          <p className="mt-5 rounded-lg bg-[var(--primary-soft)] px-4 py-3 text-sm leading-relaxed text-[#33344a]">
            {sentence}
          </p>

          <div className="mt-5 space-y-3">
            {lines.map(({ block, pct }) => (
              <div key={block.id} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-[var(--primary)]">
                  {pct}%
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#eceeF7]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="flex w-48 shrink-0 items-center gap-1.5 truncate text-xs text-[#6b6d85]">
                  <span>{RULE_TYPE_META[block.rule.type].icon}</span>
                  {block.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card mt-5 flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <p className="text-sm font-semibold">Download this model</p>
            <p className="mt-1 text-xs text-[#8688a0]">
              Saves a .json file you can re-upload later on the landing page
              to score new data with the exact same rules — no account
              needed.
            </p>
          </div>
          <button type="button" onClick={handleDownload} className="btn btn-primary shrink-0">
            ⬇ Download model{downloaded ? "ed ✓" : ""}
          </button>
        </div>

        <div className="mt-6 flex justify-between">
          <button type="button" onClick={() => router.push("/build")} className="btn btn-secondary">
            ← Back to builder
          </button>
          <button
            type="button"
            onClick={() => {
              if (!model.name.trim()) setModel({ ...model, name });
              router.push("/results");
            }}
            className="btn btn-primary"
          >
            View scored results <ArrowIcon />
          </button>
        </div>
      </main>
    </div>
  );
}
