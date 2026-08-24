"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic } from "@/lib/analysis";

/**
 * Placeholder report. The full layout (shadow ROAS, stated-vs-actual, cohort
 * table, exports) lands next; this renders the computed result so the whole
 * pipeline is verifiable end to end.
 */
export default function ReportPage() {
  const router = useRouter();
  const { file, fields, currency, businessContext } = useDiagnostic();

  useEffect(() => {
    if (!file) router.replace("/diagnostic/upload");
  }, [file, router]);

  const result = useMemo(() => {
    if (!file) return null;
    const { deals, excluded } = rowsToDeals({ rows: file.rows, fields, currency });
    return runDiagnostic({
      deals,
      excluded,
      businessContext,
      currencyCode: currency.reportingCurrency,
    });
  }, [file, fields, currency, businessContext]);

  if (!file || !result) return null;

  const v = result.verdict;

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="report" />
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <p className="label mb-2">Step 4 of 4</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Lead value diagnostic
        </h1>

        <div
          className={
            "mt-6 rounded-xl border p-5 " +
            (v.mode === "MEASURED"
              ? "border-emerald-300/60 bg-emerald-50/60"
              : v.mode === "PREDICTED"
              ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
              : "border-amber-300/60 bg-amber-50/60")
          }
        >
          <span className="mono inline-block rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-[12px] font-bold tracking-wider text-white">
            {v.mode.replace("_", " ")}
          </span>
          <h2 className="mt-3 text-[17px] font-bold">{v.headline}</h2>
          <p className="mt-1 max-w-[72ch] text-[14.5px] text-[var(--muted)]">{v.reasoning}</p>
          {v.blockers.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {v.blockers.map((b, i) => (
                <li key={i} className="text-[13.5px] text-[var(--muted)]">
                  • {b}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { k: "Rows analyzed", v: result.rowsAnalyzed.toLocaleString(), s: `${result.excluded.length} excluded` },
            { k: "Median cycle", v: result.cycle.medianDays !== null ? `${result.cycle.medianDays}d` : "—", s: result.cycle.classification ?? "no closed deals" },
            { k: "Leads / month", v: String(result.volume.leadsPerMonth), s: `${result.volume.wonDealsPerMonth} won/mo` },
            { k: "Match rate", v: `${Math.round(result.matchRate.overallRate * 100)}%`, s: result.matchRate.isTrackingGap ? "tracking gap" : "healthy" },
          ].map((s) => (
            <div key={s.k} className="card p-4">
              <p className="label">{s.k}</p>
              <p className="mono mt-1 text-2xl font-bold tracking-tight">{s.v}</p>
              <p className="mt-0.5 text-[12px] text-[var(--muted)]">{s.s}</p>
            </div>
          ))}
        </div>

        <div className="card mt-6 p-5">
          <p className="text-[15px] font-bold">Cohort values (Day-0 bidding values)</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-[10.5px] uppercase tracking-wider text-[var(--muted)]">
                  <th className="pb-2 pr-3 font-bold">Segment</th>
                  <th className="pb-2 pr-3 text-right font-bold">Leads</th>
                  <th className="pb-2 pr-3 text-right font-bold">Close rate</th>
                  <th className="pb-2 pr-3 text-right font-bold">Median deal</th>
                  <th className="pb-2 text-right font-bold">Expected value</th>
                </tr>
              </thead>
              <tbody>
                {result.cohortValues.map((c) => (
                  <tr key={c.key} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-3 font-semibold">{c.key}</td>
                    <td className="mono py-2 pr-3 text-right text-[var(--muted)]">{c.sampleSize}</td>
                    <td className="mono py-2 pr-3 text-right text-[var(--muted)]">
                      {c.closeRate !== null ? `${Math.round(c.closeRate * 100)}%` : "—"}
                    </td>
                    <td className="mono py-2 pr-3 text-right text-[var(--muted)]">
                      {c.medianWonAmount !== null ? `$${c.medianWonAmount.toLocaleString()}` : "—"}
                    </td>
                    <td className="mono py-2 text-right font-bold">
                      {c.expectedValue !== null ? `$${c.expectedValue.toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-6 border-t border-[var(--border)] pt-5 text-[13px] text-[var(--muted)]">
          Full report layout — shadow ROAS, stated-versus-actual, value spread, trust
          warnings and the Google Ads export — is next.
        </p>
      </main>
    </div>
  );
}
