"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { FlowSkeleton } from "@/components/diagnostic/FlowSkeleton";
import { ArrowIcon } from "@/components/ArrowIcon";
import type { DetectedField, FileIssue } from "@/lib/mapping/detect";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { resolveHypotheses } from "@/lib/intake/merge";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "BRL", "MXN", "NZD"];

function ConfidenceBadge({ field }: { field: DetectedField }) {
  // A suggestion read from a sentence has no measured confidence, and showing
  // a percentage for one would be inventing a number.
  if (field.column !== null && field.source === "assistant") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[var(--primary)]">
        From your description
      </span>
    );
  }
  if (field.column !== null && field.source === "user") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--background-deep)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[var(--foreground)]">
        Your choice
      </span>
    );
  }
  if (field.column === null) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--background-deep)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[var(--muted)]">
        Not found
      </span>
    );
  }
  const pct = Math.round((field.confidence ?? 0) * 100);
  const tone =
    pct >= 90
      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
      : pct >= 70
      ? "bg-[var(--primary-soft)] text-[var(--primary)]"
      : "bg-[var(--warn-soft)] text-[var(--warn)]";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${tone}`}>
      <span className="mono">{pct}%</span>
      {pct >= 90 && <span className="ml-1">✓</span>}
    </span>
  );
}

function IssueCard({ issue }: { issue: FileIssue }) {
  const warn = issue.severity === "warn";
  const [showRows, setShowRows] = useState(false);
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (warn ? "border-[var(--warn-line)] bg-[var(--warn-soft)]" : "border-[var(--border)] bg-white")
      }
    >
      <div className="flex items-start gap-3">
        <span className="text-sm leading-5">{warn ? "⚠" : "▪"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">{issue.title}</p>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">{issue.detail}</p>
        </div>
        {issue.rowIndices.length > 0 && (
          <button
            type="button"
            onClick={() => setShowRows((v) => !v)}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--primary)] hover:bg-[var(--primary-soft)]"
          >
            {showRows ? "Hide rows" : "See rows"}
          </button>
        )}
      </div>
      {showRows && (
        <p className="mono mt-3 max-h-24 overflow-y-auto rounded-lg bg-white/70 px-3 py-2 text-[12px] text-[var(--muted)]">
          Rows {issue.rowIndices.slice(0, 60).map((i) => i + 2).join(", ")}
          {issue.rowIndices.length > 60 && ` … +${issue.rowIndices.length - 60} more`}
          <span className="mt-1 block text-[11px]">(line numbers as they appear in your CSV)</span>
        </p>
      )}
    </div>
  );
}


/**
 * The first ten rows, as they came out of the file.
 *
 * Everything else on this screen is our reading of the data; this is the data.
 * Mapped columns are marked so a wrong mapping is visible against real values
 * rather than only against a header name.
 */
function RowPreview({
  headers,
  rows,
  fields,
}: {
  headers: string[];
  rows: Record<string, string>[];
  fields: DetectedField[];
}) {
  const mappedTo = new Map<string, string>();
  for (const f of fields) {
    if (f.column) mappedTo.set(f.column, f.label);
  }
  const preview = rows.slice(0, 10);

  return (
    <details className="card mt-8 overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-[13.5px] font-semibold">
        See the first 10 rows of your file
        <span className="ml-2 font-normal text-[var(--muted)]">
          the data itself, not our reading of it
        </span>
      </summary>
      <div className="overflow-x-auto border-t border-[var(--border)]">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="bg-[var(--surface-sunken)]">
              {headers.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 align-bottom">
                  <span className="mono block text-[11.5px] font-bold">{h}</span>
                  {mappedTo.has(h) ? (
                    <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[.06em] text-[var(--primary)]">
                      {mappedTo.get(h)}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[10px] uppercase tracking-[.06em] text-[var(--muted)]">
                      not used
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                {headers.map((h) => (
                  <td
                    key={h}
                    className={
                      "mono max-w-[220px] truncate px-3 py-1.5 " +
                      (mappedTo.has(h) ? "text-[var(--foreground)]" : "text-[var(--muted)]")
                    }
                    title={row[h] ?? ""}
                  >
                    {(row[h] ?? "").trim() || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--border)] px-4 py-2 text-[12px] text-[var(--muted)]">
        Showing 10 of {rows.length.toLocaleString()} rows. These stay in your browser.
      </p>
    </details>
  );
}

export default function MappingPage() {
  const router = useRouter();
  const { file, fields, setFields, issues, currency, setCurrency, stageTiming, intake, restored } =
    useDiagnostic();

  useEffect(() => {
    // Wait for the saved snapshot to be read. Redirecting before it lands
    // would send someone who just refreshed back to the start, a frame before
    // their work reappears.
    if (restored && !file) router.replace("/diagnostic/upload");
  }, [restored, file, router]);

  const mixedCurrency = issues.find((i) => i.kind === "mixed_currency");


  const { hypotheses, customSignalKeys } = useMemo(
    () =>
      intake?.status === "ready"
        ? resolveHypotheses(intake.proposal, fields)
        : { hypotheses: [], customSignalKeys: [] },
    [intake, fields]
  );

  const preview = useMemo(() => {
    if (!file) return { deals: [], excluded: [] };
    return rowsToDeals({
      rows: file.rows,
      fields,
      currency,
      stageTiming,
      signalColumns: customSignalKeys,
    });
  }, [file, fields, currency, stageTiming, customSignalKeys]);

  // Same markup on the server and during hydration; the restored flow only
  // exists in the browser and appears on the pass after.
  if (!restored) return <FlowSkeleton />;
  if (!file) return null;

  const required = fields.filter((f) => f.required);
  const missingRequired = required.filter((f) => f.column === null);

  function setColumn(key: string, column: string | null) {
    setFields(
      fields.map((f) =>
        f.key === key
          ? {
              ...f,
              column,
              // A hand-picked column is the user's call, not our inference —
              // showing a confidence score for it would be dishonest.
              confidence: column === null ? null : 1,
              reason: column === null ? null : "You chose this column",
              source: "user" as const,
              disagreement: undefined,
            }
          : f
      )
    );
  }

  const optionalKeys = ["employeeCount", "industry", "contactTitle"];
  const detectedOptional = fields.filter(
    (f) => optionalKeys.includes(f.key) && f.column !== null
  );

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="mapping" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <p className="label mb-2">Step 3 of 5</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Here&apos;s what we found in your file
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-[var(--muted)]">
          Check anything marked for review, then confirm — you&apos;re the one who
          knows your CRM.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-3.5">
          <span>✓</span>
          <p className="text-[14px] text-[var(--muted)]">
            <span className="mono font-bold text-[var(--foreground)]">
              {file.rows.length.toLocaleString()} rows
            </span>{" "}
            ·{" "}
            <span className="mono font-bold text-[var(--foreground)]">
              {file.headers.length} columns
            </span>{" "}
            read from {file.name}
          </p>
        </div>

        {/* ---- mapping table ---- */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">Column mapping</h2>
            <span className="text-[12.5px] text-[var(--muted)]">
              Change any of these if we got it wrong
            </span>
          </div>

          <div className="card overflow-hidden">
            {fields.map((field, i) => (
              <div
                key={field.key}
                className={
                  "grid items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--surface-sunken)] md:grid-cols-[170px_1fr_1.15fr_auto] " +
                  (i < fields.length - 1 ? "border-b border-[var(--border)]" : "")
                }
              >
                <div>
                  <p className="text-[13.5px] font-semibold">
                    {field.label}
                    {field.required && <span className="ml-1 text-[var(--danger)]">*</span>}
                  </p>
                  <p className="text-[11.5px] text-[var(--muted)]">{field.hint}</p>
                </div>

                <select
                  aria-label={`Column for ${field.label}`}
                  className="mono input text-[12.5px]"
                  value={field.column ?? ""}
                  onChange={(e) => setColumn(field.key, e.target.value || null)}
                >
                  <option value="">— not mapped —</option>
                  {file.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>

                <div className="text-[12.5px] leading-snug text-[var(--muted)]">
                  {field.disagreement && (
                    <span className="mb-1 block rounded-lg bg-[var(--warn-soft)] px-2 py-1 text-[12px] text-[var(--warn)]">
                      {field.disagreement}
                    </span>
                  )}
                  {field.reason ?? (
                    <span className="italic">
                      {field.required
                        ? "No matching column found — pick one to continue"
                        : "Not present in this file"}
                    </span>
                  )}
                  {field.sampleValues && field.sampleValues.length > 0 && field.sampleValues.length <= 6 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {field.sampleValues.map((v) => (
                        <span
                          key={v}
                          className="mono rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px]"
                        >
                          {v}
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                <ConfidenceBadge field={field} />
              </div>
            ))}
          </div>

          {missingRequired.length > 0 && (
            <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">
              Pick a column for{" "}
              {missingRequired.map((f) => f.label).join(", ")} before continuing —
              the analysis can&apos;t run without {missingRequired.length === 1 ? "it" : "them"}.
            </p>
          )}
        </section>

        <RowPreview headers={file.headers} rows={file.rows} fields={fields} />

        {/* ---- currency ---- */}
        {mixedCurrency && (
          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold tracking-tight">Reporting currency</h2>
              <span className="text-[12.5px] text-[var(--muted)]">
                We never convert without a rate you set
              </span>
            </div>
            <div className="card border-[var(--warn-line)] bg-[var(--warn-soft)] p-4">
              <p className="text-[13.5px] font-semibold">{mixedCurrency.title}</p>
              <p className="mt-0.5 text-[13px] text-[var(--muted)]">{mixedCurrency.detail}</p>

              <div className="mt-4 flex flex-wrap items-end gap-4">
                <label className="block">
                  <span className="label">Report everything in</span>
                  <select
                    className="input mono mt-1 w-28"
                    value={currency.reportingCurrency}
                    onChange={(e) =>
                      setCurrency({ ...currency, reportingCurrency: e.target.value })
                    }
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 pb-2 text-[13px] text-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={currency.excludeUnconvertible}
                    onChange={(e) =>
                      setCurrency({ ...currency, excludeUnconvertible: e.target.checked })
                    }
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  Exclude rows I don&apos;t set a rate for
                </label>
              </div>

              {/* Only currencies actually present in the file — asking for a
                  EUR rate on a file with no EUR rows is noise. */}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(mixedCurrency.currencies ?? [])
                  .filter((c) => c.code !== currency.reportingCurrency)
                  .map(({ code, count }) => (
                    <label key={code} className="flex items-center gap-2">
                      <span className="mono w-12 text-[12.5px] font-semibold">{code}</span>
                      <span className="text-[12.5px] text-[var(--muted)]">1 =</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="rate"
                        className="input mono w-24 text-[12.5px]"
                        value={currency.rates[code] ?? ""}
                        onChange={(e) => {
                          const rates = { ...currency.rates };
                          if (e.target.value === "") delete rates[code];
                          else rates[code] = Number(e.target.value);
                          setCurrency({ ...currency, rates });
                        }}
                      />
                      <span className="mono text-[12.5px] text-[var(--muted)]">
                        {currency.reportingCurrency}
                      </span>
                      <span className="text-[11.5px] text-[var(--muted)]">
                        ({count} {count === 1 ? "row" : "rows"})
                      </span>
                    </label>
                  ))}
              </div>
            </div>
          </section>
        )}

        {/* ---- issues ---- */}
        {issues.filter((i) => i.kind !== "mixed_currency").length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold tracking-tight">Before we analyze</h2>
              <span className="text-[12.5px] text-[var(--muted)]">
                What we found worth knowing about this file
              </span>
            </div>
            <div className="grid gap-2.5">
              {issues
                .filter((i) => i.kind !== "mixed_currency")
                .map((issue, i) => (
                  <IssueCard key={i} issue={issue} />
                ))}
            </div>
          </section>
        )}

        {/* ---- what your description added ---- */}
        {intake && intake.status !== "skipped" && (
          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold tracking-tight">From your description</h2>
              <span className="text-[12.5px] text-[var(--muted)]">
                Claims to test, not conclusions
              </span>
            </div>

            {intake.status === "unavailable" ? (
              <div className="card p-4">
                <p className="text-[13.5px] text-[var(--muted)]">{intake.reason}</p>
              </div>
            ) : hypotheses.length === 0 ? (
              <div className="card p-4">
                <p className="max-w-[74ch] text-[13.5px] text-[var(--muted)]">
                  Nothing in your description pointed at a column in this file that we
                  could test. The model will be fitted on the lead attributes we found
                  on their own.
                </p>
              </div>
            ) : (
              <div className="card p-4">
                <p className="max-w-[74ch] text-[13.5px] text-[var(--muted)]">
                  We&apos;ll test each of these against your own deals. Whether it holds
                  up or not, the report says so.
                </p>
                <ul className="mt-3 grid gap-2">
                  {hypotheses.map((h) => (
                    <li
                      key={h.factorKey}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3.5 py-2.5"
                    >
                      <p className="text-[13.5px] font-semibold">
                        &ldquo;{h.claim}&rdquo;
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">
                        Testing against{" "}
                        <span className="mono rounded-full border border-[var(--border)] bg-white px-2 py-0.5 text-[11px]">
                          {h.column}
                        </span>
                        {h.statedLevels.length > 0 && (
                          <>
                            {" · you named "}
                            {h.statedLevels.map((l) => (
                              <span
                                key={l}
                                className="mono mr-1 inline-block rounded-full border border-[var(--border)] bg-white px-2 py-0.5 text-[11px]"
                              >
                                {l}
                              </span>
                            ))}
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ---- optional columns detected ---- */}
        {detectedOptional.length > 0 && (
          <section className="mt-8">
            <div className="rounded-xl border border-[var(--primary)]/30 bg-gradient-to-br from-[var(--primary-soft)] to-white p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-[13px] font-bold text-white">
                  +
                </span>
                <div>
                  <p className="text-[14px] font-bold">
                    Extra columns we can use
                  </p>
                  <p className="mt-0.5 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
                    Found{" "}
                    {detectedOptional.map((f) => (
                      <span
                        key={f.key}
                        className="mono mr-1 inline-block rounded-full border border-[var(--border)] bg-white px-2 py-0.5 text-[11px]"
                      >
                        {f.column}
                      </span>
                    ))}
                    — enough to check how much of your won revenue actually comes from
                    the customer profile you described in step 1.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---- footer ---- */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
          <p className="max-w-[54ch] text-[13px] text-[var(--muted)]">
            <span className="mono font-semibold text-[var(--foreground)]">
              {preview.deals.length.toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="mono font-semibold text-[var(--foreground)]">
              {file.rows.length.toLocaleString()}
            </span>{" "}
            rows will be analyzed.{" "}
            {preview.excluded.length === 0 ? (
              <>Nothing was excluded.</>
            ) : (
              <>
                The{" "}
                <span className="mono">{preview.excluded.length.toLocaleString()}</span>{" "}
                excluded {preview.excluded.length === 1 ? "row" : "rows"} and the reason
                for each are carried through to the report — nothing disappears silently.
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => router.push("/diagnostic/upload")}
              className="btn btn-secondary"
            >
              Replace file
            </button>
            <button
              type="button"
              disabled={missingRequired.length > 0}
              onClick={() => router.push("/diagnostic/report")}
              className="btn btn-primary"
            >
              Run the analysis <ArrowIcon />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
