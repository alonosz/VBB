"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/context/AppStateContext";
import { StepHeader } from "@/components/StepHeader";
import { TierBadge } from "@/components/TierBadge";
import { Histogram } from "@/components/Histogram";
import { computeHistogram, computeModelScores } from "@/lib/scoring";
import { ArrowIcon } from "@/components/ArrowIcon";

const PAGE_SIZE = 50;

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="card p-4">
      <p className="label">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[#8688a0]">{sub}</p>}
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const { csvData, model, matchConfig } = useAppState();
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!csvData) {
      router.replace("/upload");
      return;
    }
    if (!model || model.blocks.filter((b) => b.enabled).length === 0) {
      router.replace("/build");
    }
  }, [csvData, model, router]);

  const scored = useMemo(() => {
    if (!csvData || !model) return [];
    return computeModelScores(csvData.rows, model, matchConfig.column);
  }, [csvData, model, matchConfig.column]);

  const included = useMemo(() => scored.filter((s) => !s.excluded), [scored]);
  const excluded = useMemo(() => scored.filter((s) => s.excluded), [scored]);
  const histogram = useMemo(() => computeHistogram(scored), [scored]);

  const avgScore = included.length
    ? Math.round(included.reduce((s, r) => s + r.score, 0) / included.length)
    : 0;

  const tierCounts = useMemo(() => {
    const counts = { High: 0, Medium: 0, Low: 0 };
    for (const r of included) counts[r.tier] += 1;
    return counts;
  }, [included]);

  const pageCount = Math.max(1, Math.ceil(scored.length / PAGE_SIZE));
  const pageRows = scored.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (!csvData || !model) return null;

  const pct = (n: number) =>
    included.length ? `${Math.round((n / included.length) * 100)}%` : "0%";

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <StepHeader current="results" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Scored results</h1>
        <p className="mt-1 text-sm text-[#6b6d85]">
          &ldquo;{model.name || "Untitled Model"}&rdquo; applied to{" "}
          {csvData.rowCount.toLocaleString()} rows from {csvData.fileName}.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Records scored"
            value={included.length.toLocaleString()}
            sub={excluded.length ? `${excluded.length.toLocaleString()} excluded` : undefined}
          />
          <StatCard label="Average score" value={String(avgScore)} sub="out of 100" />
          <StatCard
            label="High / Medium tier"
            value={`${pct(tierCounts.High)} / ${pct(tierCounts.Medium)}`}
            sub={`${tierCounts.High.toLocaleString()} high, ${tierCounts.Medium.toLocaleString()} medium`}
          />
          <StatCard
            label="Low tier"
            value={pct(tierCounts.Low)}
            sub={`${tierCounts.Low.toLocaleString()} records`}
          />
        </div>

        <div className="card mt-6 p-5">
          <p className="text-sm font-semibold">Score distribution</p>
          <div className="mt-2">
            <Histogram data={histogram} />
          </div>
        </div>

        {excluded.length > 0 && (
          <div className="card mt-6 border-amber-200 bg-amber-50/40 p-5">
            <p className="text-sm font-semibold text-amber-800">
              {excluded.length.toLocaleString()} row(s) excluded
            </p>
            <p className="mt-1 text-xs text-amber-700">
              These rows are missing the match field (
              {matchConfig.column ?? "none selected"}) needed to export
              conversions to an ad platform. They&apos;re shown here for
              visibility but left out of tier stats above.
            </p>
            <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-amber-200 bg-white">
              <table className="w-full text-left text-xs">
                <tbody>
                  {excluded.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-b border-amber-100 last:border-0">
                      <td className="px-3 py-1.5 text-[#33344a]">
                        {csvData.headers
                          .slice(0, 3)
                          .map((h) => r.row[h])
                          .filter(Boolean)
                          .join(" · ") || `Row ${i + 1}`}
                      </td>
                      <td className="px-3 py-1.5 text-amber-700">{r.exclusionReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {excluded.length > 200 && (
                <p className="px-3 py-2 text-[11px] text-amber-600">
                  + {(excluded.length - 200).toLocaleString()} more not shown
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="label">All records</p>
            <div className="flex items-center gap-2 text-xs text-[#6b6d85]">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="btn btn-ghost px-2 py-1 disabled:opacity-30"
              >
                ← Prev
              </button>
              <span>
                Page {page + 1} of {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="btn btn-ghost px-2 py-1 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead>
                <tr className="bg-[#f8f8fc]">
                  {csvData.headers.map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6b6d85]"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="whitespace-nowrap border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6b6d85]">
                    Score
                  </th>
                  <th className="whitespace-nowrap border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6b6d85]">
                    Tier
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr
                    key={i}
                    className={
                      "border-b border-[var(--border)] last:border-0 even:bg-[#fbfbfd] " +
                      (r.excluded ? "opacity-50" : "")
                    }
                  >
                    {csvData.headers.map((h) => (
                      <td
                        key={h}
                        className="max-w-[200px] truncate whitespace-nowrap px-3 py-2 text-[#33344a]"
                        title={r.row[h]}
                      >
                        {r.row[h] || <span className="text-[#c7c8d6]">—</span>}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">
                      {r.score}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.excluded ? (
                        <span className="text-xs text-[#b3b4c6]">excluded</span>
                      ) : (
                        <TierBadge tier={r.tier} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 flex justify-between">
          <button type="button" onClick={() => router.push("/summary")} className="btn btn-secondary">
            ← Back to summary
          </button>
          <button type="button" onClick={() => router.push("/export")} className="btn btn-primary">
            Continue to export <ArrowIcon />
          </button>
        </div>
      </main>
    </div>
  );
}
