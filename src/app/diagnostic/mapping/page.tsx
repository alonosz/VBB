"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { FlowSkeleton } from "@/components/diagnostic/FlowSkeleton";
import { ArrowIcon } from "@/components/ArrowIcon";
import type { DetectedField, FileIssue } from "@/lib/mapping/detect";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { useSignalColumns } from "@/lib/diagnostic/useSignals";
import { COMPANY_FIELD_KEYS } from "@/lib/mapping/signals";
import { outcomeVocabulary } from "@/lib/mapping/outcomes";
import type { DealOutcome } from "@/lib/analysis/types";
import { PageHead } from "@/components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "INR", "BRL", "MXN", "NZD"];

function ConfidenceBadge({ field }: { field: DetectedField }) {
  // A suggestion read from a sentence has no measured confidence, and showing
  // a percentage for one would be inventing a number.
  if (field.column !== null && field.source === "assistant") {
    return (
      <span className="badge badge-primary whitespace-nowrap">From your description</span>
    );
  }
  if (field.column !== null && field.source === "user") {
    return (
      <span className="badge badge-neutral whitespace-nowrap">Your choice</span>
    );
  }
  if (field.column === null) {
    return (
      <span className="badge badge-neutral whitespace-nowrap">Not found</span>
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
        (warn ? "border-[var(--warn-line)] bg-[var(--warn-soft)]" : "border-[var(--border)] bg-[var(--surface)]")
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
        <p className="mono mt-3 max-h-24 overflow-y-auto rounded-lg bg-[var(--surface)]/75 px-3 py-2 text-[12px] text-[var(--muted)]">
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
  isSignal,
}: {
  headers: string[];
  rows: Record<string, string>[];
  fields: DetectedField[];
  /** Columns the engine will test as value signals. */
  isSignal: (column: string) => boolean;
}) {
  const mappedTo = new Map<string, string>();
  for (const f of fields) {
    if (f.column) mappedTo.set(f.column, f.label);
  }
  /*
   * A third state. Discovery means a column can be unmapped and still used,
   * and this header said "not used" about columns the engine was pricing on -
   * a false statement about the very thing the screen exists to make visible.
   */
  const labelFor = (h: string): { text: string; tone: "mapped" | "signal" | "unused" } =>
    mappedTo.has(h)
      ? { text: mappedTo.get(h)!, tone: "mapped" }
      : isSignal(h)
        ? { text: "tested as a signal", tone: "signal" }
        : { text: "not used", tone: "unused" };
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
                  {(() => {
                    const l = labelFor(h);
                    return (
                      <span
                        className={
                          "mt-0.5 block text-[10px] uppercase tracking-[.06em] " +
                          (l.tone === "mapped"
                            ? "font-bold text-[var(--primary)]"
                            : l.tone === "signal"
                              ? "font-bold text-[var(--accent)]"
                              : "text-[var(--muted)]")
                        }
                      >
                        {l.text}
                      </span>
                    );
                  })()}
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
                      (mappedTo.has(h) || isSignal(h)
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted)]")
                    }
                    title={row[h] ?? ""}
                  >
                    {(row[h] ?? "").trim() || "-"}
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
  const { audience, file, fields, setFields, issues, currency, setCurrency, stageTiming, intake, restored, setSignalOverride, outcomeOverrides, setOutcomeOverride } =
    useDiagnostic();

  useEffect(() => {
    // Wait for the saved snapshot to be read. Redirecting before it lands
    // would send someone who just refreshed back to the start, a frame before
    // their work reappears.
    if (restored && !file) router.replace("/diagnostic/upload");
  }, [restored, file, router]);

  const mixedCurrency = issues.find((i) => i.kind === "mixed_currency");


  const signals = useSignalColumns();

  const { hypotheses, customSignalKeys } = useMemo(
    () => ({ hypotheses: signals.hypotheses, customSignalKeys: signals.customSignalKeys }),
    [signals]
  );

  const preview = useMemo(() => {
    if (!file) return { deals: [], excluded: [] };
    return rowsToDeals({
      rows: file.rows,
      fields,
      currency,
      stageTiming,
      signalColumns: customSignalKeys,
      outcomeOverrides,
    });
  }, [file, fields, currency, stageTiming, customSignalKeys, outcomeOverrides]);

  const vocabulary = useMemo(() => {
    if (!file) return null;
    const col = (key: string) => fields.find((f) => f.key === key)?.column ?? null;
    return outcomeVocabulary(file.rows, col("outcome"), col("stage"), outcomeOverrides);
  }, [file, fields, outcomeOverrides]);

  // Same markup on the server and during hydration; the restored flow only
  // exists in the browser and appears on the pass after.
  if (!restored) return <FlowSkeleton />;
  if (!file) return null;

  /*
   * A stage column is how we read won and lost when there is no outcome
   * column, and it is what the trust and early-gate checks read. With an
   * outcome column mapped it is no longer the thing standing between the
   * file and a report: a sheet with a status column and no pipeline is a
   * perfectly good consumer file.
   */
  const outcomeMapped = fields.some((f) => f.key === "outcome" && f.column !== null);
  const blocks = (f: DetectedField) =>
    f.required && f.column === null && !(f.key === "stage" && outcomeMapped);
  const missingRequired = fields.filter(blocks);

  function setColumn(key: string, column: string | null) {
    setFields(
      fields.map((f) =>
        f.key === key
          ? {
              ...f,
              column,
              // A hand-picked column is the user's call, not our inference -
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

  /*
   * Headcount, industry and job title describe a company. On a consumer file
   * the engine drops the factors built on them, so offering them here asks
   * somebody to map three columns that will then be ignored - and tells them
   * the tool was built for a different kind of business, which is the whole
   * thing the audience question exists to stop saying.
   */
  const isCompanyField = (key: string) =>
    (COMPANY_FIELD_KEYS as readonly string[]).includes(key);
  const shown = fields.filter((f) => audience !== "b2c" || !isCompanyField(f.key));

  const detectedOptional = shown.filter((f) => isCompanyField(f.key) && f.column !== null);

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="mapping" />
      <main className="page-wide animate-page-in flex-1 py-10">
        <PageHead
          eyebrow="Step 3 of 5 · Map columns"
          title="Here's what we found in your file"
          lede="Check anything marked for review, then confirm - you're the one who knows your CRM."
        />

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-2">
          <span aria-hidden className="text-[var(--accent)]">✓</span>
          <span className="mono text-[12.5px] font-bold">
            {file.rows.length.toLocaleString()} rows
          </span>
          <span aria-hidden className="text-[var(--accent-line)]">·</span>
          <span className="mono text-[12.5px] font-bold">
            {file.headers.length} columns
          </span>
          <span className="mono max-w-[32ch] truncate text-[12.5px] text-[var(--muted)]" title={file.name}>
            read from {file.name}
          </span>
        </div>

        {/* ---- mapping table ---- */}
        {/*
          Required and optional are separated rather than run together in one
          list of thirteen identical rows. Everything that can block the
          analysis is above the fold; everything that only sharpens it is
          below, and the eye no longer has to read each label to find out
          which is which.
        */}
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="h2">Column mapping</h2>
            <span className="text-[12.5px] text-[var(--muted)]">
              Change any of these if we got it wrong
            </span>
          </div>

          <div className="grid gap-5">
            {(
              [
                {
                  key: "required",
                  title: "Needed to run",
                  note: "The analysis cannot start without these.",
                  rows: shown.filter((f) => f.required),
                },
                {
                  key: "optional",
                  title: "Makes it sharper",
                  note: "Each one adds a signal the model can test. Leave any unmapped.",
                  rows: shown.filter((f) => !f.required),
                },
              ] as const
            ).map((group) =>
              group.rows.length === 0 ? null : (
                <div key={group.key}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="label">{group.title}</h3>
                    <span className="text-[12px] text-[var(--muted)]">{group.note}</span>
                  </div>

                  <div className="card overflow-hidden p-0">
                    {group.rows.map((field, i) => {
                      // One rail, one meaning: this row is why you are on this
                      // screen. Red when it blocks, amber when we are unsure.
                      const blocking = blocks(field);
                      const unsure =
                        !blocking &&
                        (Boolean(field.disagreement) ||
                          (field.source === "heuristic" &&
                            field.column !== null &&
                            (field.confidence ?? 1) < 0.7));

                      return (
                        <div
                          key={field.key}
                          className={
                            "grid items-center gap-4 border-l-[3px] px-4 py-3.5 transition-colors hover:bg-[var(--surface-sunken)] md:grid-cols-[170px_1fr_1.15fr_auto] " +
                            (i < group.rows.length - 1
                              ? "border-b border-b-[var(--border)] "
                              : "") +
                            (blocking
                              ? "border-l-[var(--danger)] bg-[var(--danger-soft)]/50"
                              : unsure
                                ? "border-l-[var(--warn)] bg-[var(--warn-soft)]/50"
                                : "border-l-transparent")
                          }
                        >
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-semibold">
                              {field.label}
                              {field.required && (
                                <span
                                  className="ml-1 text-[var(--danger)]"
                                  aria-label="required"
                                >
                                  *
                                </span>
                              )}
                            </p>
                            <p className="text-[11.5px] text-[var(--muted)]">
                              {field.hint}
                            </p>
                          </div>

                          <select
                            aria-label={`Column for ${field.label}`}
                            className="mono select text-[12.5px]"
                            value={field.column ?? ""}
                            onChange={(e) => setColumn(field.key, e.target.value || null)}
                          >
                            <option value="">- not mapped -</option>
                            {file.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>

                          <div className="min-w-0 text-[12.5px] leading-snug text-[var(--muted)]">
                            {field.disagreement && (
                              <span className="mb-1 block rounded-[var(--radius-sm)] bg-[var(--warn-soft)] px-2 py-1 text-[12px] font-medium text-[var(--warn)]">
                                {field.disagreement}
                              </span>
                            )}
                            {field.reason ?? (
                              <span className="italic">
                                {field.required
                                  ? "No matching column found - pick one to continue"
                                  : "Not present in this file"}
                              </span>
                            )}
                            {field.sampleValues &&
                              field.sampleValues.length > 0 &&
                              field.sampleValues.length <= 6 && (
                                <span className="mt-1.5 flex flex-wrap gap-1">
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
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>

          {missingRequired.length > 0 && (
            <p className="alert alert-bad mt-4 text-[13px] font-medium" role="alert">
              Pick a column for {missingRequired.map((f) => f.label).join(", ")} before
              continuing - the analysis can&apos;t run without{" "}
              {missingRequired.length === 1 ? "it" : "them"}.
            </p>
          )}
        </section>

        {/*
          Which values mean a sale.

          Every close rate in the report rests on reading the outcome or
          stage column right, and the built-in list cannot know every
          vertical's word for a customer. So the reading of each value is
          shown, most common first, with the advertiser's word winning over
          ours on the exact value they set it on.
        */}
        {vocabulary && (
          <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="h2">What counts as a sale</h2>
              <span className="text-[12.5px] text-[var(--muted)]">
                Read from <span className="mono">{vocabulary.column}</span> - every close rate
                rests on this
              </span>
            </div>

            {vocabulary.won === 0 && (
              <p className="alert alert-bad mb-3 text-[13px] font-medium" role="alert">
                None of these reads as a sale. Mark the value that means a customer, or
                the analysis has nothing to price.
              </p>
            )}

            <div className="grid gap-2">
              {vocabulary.values.map((v) => (
                <div
                  key={v.value}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="mono block text-[13px] font-bold">{v.value}</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--muted)]">
                      <span className="mono">{v.count.toLocaleString()}</span> rows
                      {v.by === "you" && (
                        <>
                          {" · you set this · "}
                          <button
                            type="button"
                            onClick={() => setOutcomeOverride(v.value, null)}
                            className="font-semibold text-[var(--primary)] underline underline-offset-[3px]"
                          >
                            use our reading
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  <div
                    role="group"
                    aria-label={`How "${v.value}" is read`}
                    className="flex shrink-0 gap-1"
                  >
                    {(
                      [
                        ["won", "Sale"],
                        ["lost", "Lost"],
                        ["open", "Still open"],
                      ] as [DealOutcome, string][]
                    ).map(([o, label]) => {
                      const on = v.read === o;
                      return (
                        <button
                          key={o}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setOutcomeOverride(v.value, o === v.rule ? null : o)}
                          className={
                            "rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors " +
                            (on
                              ? o === "won"
                                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                                : o === "lost"
                                  ? "border-[var(--danger)]/60 bg-[var(--danger-soft)] text-[var(--danger)]"
                                  : "border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--foreground)]"
                              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]")
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {vocabulary.more > 0 && (
              <p className="mt-2 text-[12.5px] text-[var(--muted)]">
                And <span className="mono">{vocabulary.more.toLocaleString()}</span> more
                distinct values, which suggests this is not a status column. Check the
                mapping above.
              </p>
            )}

            <p className="mt-3 text-[12.5px] text-[var(--muted)]">
              <span className="mono font-semibold text-[var(--foreground)]">
                {vocabulary.won.toLocaleString()}
              </span>{" "}
              sales ·{" "}
              <span className="mono font-semibold text-[var(--foreground)]">
                {vocabulary.lost.toLocaleString()}
              </span>{" "}
              lost ·{" "}
              <span className="mono font-semibold text-[var(--foreground)]">
                {vocabulary.open.toLocaleString()}
              </span>{" "}
              still open. Open leads are left out of close rates, never counted against
              you.
            </p>
          </section>
        )}

        {/*
          What else in the file might price a lead.

          The mapping above answers "which column is the create date". This
          answers the question the mapping cannot: which of the remaining
          columns carry signal. The engine decides that by shape, and the
          shape rules are a judgement about what usually works, not a fact
          about this file - so they are shown as suggestions with a switch
          beside each, and the advertiser gets the last word. Everything they
          turn on still has to clear the same sample-size and lift tests, and
          is reported dropped with a reason if it carries nothing.
        */}
        {(signals.discovered.length > 0 || signals.refused.length > 0) && (
          <section className="mt-8">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="h2">Signals we&apos;ll test</h2>
              <span className="text-[12.5px] text-[var(--muted)]">
                Nothing here is priced yet - each one is tested against your closed deals
              </span>
            </div>

            {signals.discovered.length > 0 && (
              <div className="grid gap-2">
                {signals.discovered.map((d) => {
                  const on = signals.isOn(d.column);
                  const claimed = signals.fromClaim.has(d.column);
                  return (
                    <div
                      key={d.column}
                      className={
                        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors " +
                        (on
                          ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]/40"
                          : "border-[var(--border)] bg-[var(--surface)]")
                      }
                    >
                      <div className="min-w-0">
                        <span className="mono block text-[13px] font-bold">{d.column}</span>
                        <span className="mt-0.5 block max-w-[70ch] text-[12.5px] text-[var(--muted)]">
                          {claimed
                            ? "You mentioned this in your description, so we test it whatever its shape."
                            : d.reason}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSignalOverride(d.column, !on)}
                        aria-pressed={on}
                        className={
                          "shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors " +
                          (on
                            ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                            : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]")
                        }
                      >
                        {on ? "Testing" : "Not testing"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/*
              Shown here as well as in the report, because this is the screen
              where somebody would otherwise go looking for the column and
              wonder why it is missing.
            */}
            {signals.refused.length > 0 && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5">
                <p className="label">Never tested</p>
                <ul className="mt-2 grid gap-2">
                  {signals.refused.map((r) => (
                    <li key={r.column}>
                      <span className="mono text-[12.5px] font-bold">{r.column}</span>
                      <span className="mt-0.5 block max-w-[70ch] text-[12.5px] text-[var(--muted)]">
                        {r.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* `shown`, not `fields`: a column the audience has taken out of the
            mapping must not be highlighted here as though it were mapped. */}
        <RowPreview
          headers={file.headers}
          rows={file.rows}
          fields={shown}
          isSignal={signals.isOn}
        />

        {/* ---- currency ---- */}
        {mixedCurrency && (
          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="h3">Reporting currency</h2>
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
                    className="select mono mt-1 w-28"
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

              {/* Only currencies actually present in the file - asking for a
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
              <h2 className="h3">Before we analyze</h2>
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
              <h2 className="h3">From your description</h2>
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
                        <span className="mono rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px]">
                          {h.column}
                        </span>
                        {h.statedLevels.length > 0 && (
                          <>
                            {" · you named "}
                            {h.statedLevels.map((l) => (
                              <span
                                key={l}
                                className="mono mr-1 inline-block rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px]"
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
                        className="mono mr-1 inline-block rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px]"
                      >
                        {f.column}
                      </span>
                    ))}
                    - enough to check how much of your won revenue actually comes from
                    the customer profile you described in step 1.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---- footer ---- */}
        {/* This page runs well past a screen, and the button that leaves it was
            at the very bottom. It now follows you down. */}
        <div className="sticky bottom-0 z-20 -mx-5 mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_88%,transparent)] px-5 py-4 backdrop-blur-md md:-mx-8 md:px-8">
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
                for each are carried through to the report - nothing disappears silently.
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
