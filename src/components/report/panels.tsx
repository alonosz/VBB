"use client";

import { useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { judgeClaim } from "@/lib/analysis/judgeClaim";
import type {
  MappedDeal,
  MatchRateReadiness,
  ValueSpread,
  Verdict,
  VolumeCheck,
} from "@/lib/analysis/types";
import type {
  FactorLevel,
  ModelFactor,
  ValueModel,
  ValuedLead,
  ExampleStack,
} from "@/lib/analysis/valueModel";
import type { GateValue } from "@/lib/analysis/gateValue";
import {
  MAX_STACK_DEVIATION,
  effectiveMultiplier,
  overrideKey,
} from "@/lib/analysis/valueModel";

export function money(n: number, currency = "USD", dp = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: dp,
  }).format(n);
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// ---------------------------------------------------------------------------
// PANEL 1 - the hook
// ---------------------------------------------------------------------------

export function HookPanel({
  spread,
  valued,
  currency,
  flat,
  onFixSignals,
}: {
  spread: ValueSpread;
  valued: ValuedLead[];
  currency: string;
  /** True when no signal cleared the thresholds and every lead is priced the same. */
  flat: boolean;
  onFixSignals: () => void;
}) {
  if (spread.sampleSize === 0 || spread.min === null || spread.max === null) {
    return null;
  }

  // Log-spaced buckets: realised deal values span orders of magnitude, so a
  // linear histogram would pile everything into the first bar.
  const values = valued.map((v) => v.value).filter((v) => v > 0).sort((a, b) => a - b);
  const BUCKETS = 24;
  const lo = Math.log(Math.max(1, values[0] ?? 1));
  const hi = Math.log(Math.max(2, values[values.length - 1] ?? 2));
  const counts = new Array(BUCKETS).fill(0);
  for (const v of values) {
    const t = (Math.log(Math.max(1, v)) - lo) / Math.max(1e-9, hi - lo);
    counts[Math.min(BUCKETS - 1, Math.max(0, Math.floor(t * BUCKETS)))] += 1;
  }
  const peak = Math.max(...counts, 1);

  const low = values[0] ?? 0;
  const high = values.at(-1) ?? 0;
  const mean = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;

  return (
    <section className="panel-navy overflow-hidden">
      <div className="p-6 sm:p-9">
        <p className="label" style={{ color: "var(--on-navy-muted)" }}>
          The spread Google cannot see
        </p>

        {/*
          The headline is the product's whole argument in one sentence, so it
          gets display type and the figures get the mono treatment that makes
          them read as measurements rather than marketing.
        */}
        <h2 className="display mt-3 max-w-[22ch]" style={{ color: "var(--on-navy)" }}>
          Your closed deals run from{" "}
          <span className="mono text-[.86em] text-[var(--primary-soft)]">
            {money(spread.min, currency)}
          </span>{" "}
          to{" "}
          <span className="mono text-[.86em] text-[var(--primary-soft)]">
            {money(spread.max, currency)}
          </span>
          .
        </h2>

        <p
          className="lede mt-3 max-w-[48ch]"
          style={{ color: "var(--on-navy-muted)" }}
        >
          Google Ads gets one number for every lead that produced them, so it
          bids as if they were all the same.
        </p>

        {spread.blindnessRatio !== null && (
          <div className="mt-6 inline-flex items-baseline gap-2.5 rounded-full border border-[var(--navy-line)] bg-[var(--surface)]/[.05] px-4 py-2">
            <span
              className="mono text-[22px] font-bold leading-none"
              style={{ color: "var(--primary-on-navy)" }}
            >
              {spread.blindnessRatio}×
            </span>
            <span
              className="text-[12.5px] font-semibold"
              style={{ color: "var(--on-navy-muted)" }}
            >
              between your smallest and largest closed deal
            </span>
          </div>
        )}
      </div>

      {/*
        The blindness comparison. Flat grey is what Google sees today - one
        number for every lead - against the real distribution in brand blue.
        The grey reading as grey is the message.
      */}
      <div className="border-t border-[var(--navy-line)] bg-black/15 p-6 sm:p-9">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <figure className="min-w-0">
            <figcaption className="mb-3">
              <p
                className="text-[13px] font-bold"
                style={{ color: "var(--on-navy-muted)" }}
              >
                What one flat value looks like
              </p>
              <p className="mono mt-0.5 text-[12px]" style={{ color: "var(--on-navy-faint)" }}>
                {money(mean, currency)} × {values.length.toLocaleString()} leads
              </p>
            </figcaption>
            <div
              className="flex h-24 items-end gap-[2px]"
              role="img"
              aria-label={`Every lead reported at the same value, ${money(mean, currency)}`}
            >
              {counts.map((_, i) => (
                <div key={i} className="bar-flat h-1/2 flex-1" />
              ))}
            </div>
            <p
              className="mt-2.5 max-w-[36ch] text-[12px]"
              style={{ color: "var(--on-navy-faint)" }}
            >
              The best a single number can do is your average. Nothing in it
              separates a good lead from a bad one.
            </p>
          </figure>

          {/*
            A flat model used to land here as "what your model will send
            instead: $2,195 - $2,195 per lead", over a chart with one tall bar
            and twenty-three stubs, because every value fell in the first
            log bucket. It read as a win and it was the opposite of one. When
            nothing separates the leads, this side says so and points at the
            screen where that gets fixed.
          */}
          {flat ? (
            <div className="min-w-0">
              <p className="text-[13px] font-bold" style={{ color: "var(--on-navy)" }}>
                Right now your model would send one value too
              </p>
              <p
                className="mono mt-0.5 text-[12px]"
                style={{ color: "var(--on-navy-muted)" }}
              >
                {money(mean, currency)} × {values.length.toLocaleString()} leads
              </p>
              <p
                className="mt-3 max-w-[52ch] text-[13px]"
                style={{ color: "var(--on-navy-muted)" }}
              >
                Nothing in this file separated a good lead from a bad one by enough
                to price them differently, so every lead gets your average. That is
                still better than counting each form-fill as 1, but it is not the
                spread above. The columns tested, and the ones left out, are on the
                mapping screen.
              </p>
              <button
                type="button"
                onClick={onFixSignals}
                className="mt-4 text-[13px] font-semibold underline underline-offset-[3px]"
                style={{ color: "var(--primary-on-navy)" }}
              >
                Choose which columns to test
              </button>
            </div>
          ) : (
          <figure className="min-w-0">
            <figcaption className="mb-3">
              <p className="text-[13px] font-bold" style={{ color: "var(--on-navy)" }}>
                What your model will send instead
              </p>
              <p
                className="mono mt-0.5 text-[12px]"
                style={{ color: "var(--on-navy-muted)" }}
              >
                {money(low, currency)} - {money(high, currency)} per lead
              </p>
            </figcaption>
            <div
              className="flex h-24 items-end gap-[2px]"
              role="img"
              aria-label={`Distribution of modelled lead values from ${money(low, currency)} to ${money(high, currency)}`}
            >
              {counts.map((c, i) => (
                <div
                  key={i}
                  className="bar flex-1"
                  style={{
                    height: `${Math.max(3, (c / peak) * 100)}%`,
                    background: `linear-gradient(180deg, var(--primary-on-navy) 0%, var(--primary) 100%)`,
                    opacity: 0.45 + 0.55 * (i / BUCKETS),
                  }}
                />
              ))}
            </div>
            <p
              className="mt-2.5 max-w-[58ch] text-[12px]"
              style={{ color: "var(--on-navy-muted)" }}
            >
              {values.length.toLocaleString()} leads, priced individually. The range is
              narrower than your realised deal values because a value is an expectation
              at lead creation, not a closed deal.
            </p>
          </figure>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PANEL 2 - the value model
// ---------------------------------------------------------------------------

/**
 * One multiplier, editable.
 *
 * Marketers do not trust a number they cannot argue with, so every multiplier
 * is a field rather than a label - with the sample size, close rate and capped
 * deal behind it sitting right there, and a one-click way back to what we
 * fitted.
 */
function MultiplierCell({
  factorKey,
  level,
  overrides,
  onOverride,
}: {
  factorKey: string;
  level: FactorLevel;
  overrides?: Record<string, number>;
  onOverride?: (key: string, value: number | null) => void;
}) {
  const key = overrideKey(factorKey, level.level);
  const current = effectiveMultiplier(factorKey, level, overrides);
  const edited = current !== level.lift;

  // What the field shows while it is being typed in. Without this, clearing the
  // box to retype reads as "no value", the override drops, and the number
  // snaps back under the user's cursor.
  const [draft, setDraft] = useState<string | null>(null);

  if (!onOverride) {
    return (
      <span
        className={
          "mono shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold " +
          (current >= 1
            ? "bg-[var(--primary-soft)] text-[var(--primary-deep)]"
            : "bg-[var(--surface-sunken)] text-[var(--muted-strong)]")
        }
      >
        ×{current}
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {edited && (
        <button
          type="button"
          onClick={() => {
            onOverride(key, null);
            setDraft(null);
          }}
          title={`Reset to the fitted ×${level.lift}`}
          className="text-[11px] font-semibold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]"
        >
          reset
        </button>
      )}
      <span
        className={
          "mono flex items-center rounded-full border px-1.5 py-0.5 text-[12px] font-bold transition-colors " +
          (edited
            ? "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]"
            : current >= 1
              ? "border-transparent bg-[var(--primary-soft)] text-[var(--primary-deep)]"
              : "border-transparent bg-[var(--surface-sunken)] text-[var(--muted-strong)]")
        }
      >
        ×
        <input
          type="number"
          step="0.01"
          min="0.01"
          aria-label={`Multiplier for ${level.level}`}
          value={draft ?? String(current)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (raw.trim() !== "" && Number.isFinite(n) && n > 0) onOverride(key, n);
          }}
          onBlur={() => {
            // An empty or nonsensical box on the way out means "use what you
            // fitted", which is the safe reading of an abandoned edit.
            const n = Number(draft);
            if (draft !== null && (draft.trim() === "" || !Number.isFinite(n) || n <= 0)) {
              onOverride(key, null);
            }
            setDraft(null);
          }}
          className="mono w-[4.2rem] bg-transparent text-[12px] font-bold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </span>
    </span>
  );
}

function FactorRow({
  factor,
  currency,
  overrides,
  onOverride,
}: {
  factor: ModelFactor;
  currency: string;
  overrides?: Record<string, number>;
  onOverride?: (key: string, value: number | null) => void;
}) {
  const usable = factor.levels.filter((l) => l.usable);
  const thin = factor.levels.filter((l) => !l.usable);

  return (
    <div className="border-t border-[var(--border)] px-4 py-3.5 first:border-t-0 sm:px-5">
      <p className="text-[13px] font-bold">{factor.label}</p>
      <div className="mt-2 grid gap-1.5">
        {usable.map((l) => (
          <div key={l.level} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-medium">{l.level}</span>
              <span className="mono text-[11.5px] text-[var(--muted)]">
                n={l.sampleSize} · {(l.closeRate * 100).toFixed(1)}% close ·{" "}
                {l.avgWonAmount !== null ? (
                  <>{money(l.avgWonAmount, currency)} avg won</>
                ) : l.medianWonAmount !== null ? (
                  // A model saved before the capped average existed. The
                  // median is what its multipliers were fitted on, so it is
                  // the honest stat to show beside them.
                  <>{money(l.medianWonAmount, currency)} median</>
                ) : (
                  "-"
                )}
              </span>
            </span>
            <MultiplierCell
              factorKey={factor.key}
              level={l}
              overrides={overrides}
              onOverride={onOverride}
            />
          </div>
        ))}
        {thin.length > 0 && (
          <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">
            {thin.map((l) => `${l.level} (n=${l.sampleSize})`).join(", ")} -{" "}
            {thin.length === 1 ? "too few deals" : "too few deals each"} to price, so
            {thin.length === 1 ? " it gets" : " they get"} the base value.
          </p>
        )}
      </div>
    </div>
  );
}

export function ValueModelPanel({
  model,
  stack,
  spread,
  examples,
  currency,
  overrides,
  onOverride,
  onResetAll,
}: {
  model: ValueModel;
  stack: ExampleStack;
  spread: ValueSpread;
  examples: ValuedLead[];
  currency: string;
  overrides?: Record<string, number>;
  onOverride?: (key: string, value: number | null) => void;
  onResetAll?: () => void;
}) {
  const editCount = Object.keys(overrides ?? {}).length;

  return (
    <section>
      <div className="mb-4">
        <h2 className="h2">Your value model</h2>
        <p className="mt-1.5 max-w-[72ch] text-[14px] text-[var(--muted)]">
          Built only from what is knowable the moment a lead arrives. Every multiplier
          comes from your own closed deals, and no number here is one you cannot trace
          back to rows in your file.{" "}
          {onOverride && <>Disagree with one? Type over it - the table below updates as you go.</>}
        </p>
      </div>

      {editCount > 0 && onResetAll && (
        <div className="alert alert-warn mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px]">
            <span className="font-semibold">
              {editCount} multiplier{editCount === 1 ? "" : "s"} edited.
            </span>{" "}
            <span className="text-[var(--muted)]">
              We rescaled the model to{" "}
              <span className="mono">×{model.calibrationFactor.toFixed(3)}</span> so your leads still
              average out to what your data actually shows.
            </span>
          </p>
          <button
            type="button"
            onClick={onResetAll}
            className="shrink-0 text-[12.5px] font-semibold text-[var(--primary)] underline underline-offset-[3px] hover:text-[var(--primary-hover)]"
          >
            Reset all to computed
          </button>
        </div>
      )}

      {model.isFlat ? (
        <div className="alert alert-warn">
          <p className="text-[14px] font-bold">
            No attribute in this file predicts value strongly enough to use.
          </p>
          <p className="mt-1 max-w-[72ch] text-[13.5px] text-[var(--muted)]">
            Every lead gets the same value -{" "}
            <span className="mono font-semibold text-[var(--foreground)]">
              {money(model.baseValue, currency)}
            </span>
            , your overall expected value per lead. That is still a real improvement on
            counting every form-fill as 1, but the signals tested below did not separate
            good leads from bad ones by enough to price differently.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[1.05fr_.95fr]">
          {/* The rule stack */}
          {/* The stack is the summary the signals list explains, so it stays
              in view while that list scrolls past it. */}
          <div className="card p-5 sm:p-6 lg:sticky lg:top-20">
            <p className="label mb-3.5">The rule stack - best case</p>
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3 pb-1">
                <span className="text-[13.5px] font-semibold">Base value</span>
                <span className="mono text-[15px] font-bold">
                  {money(model.baseValue, currency, 2)}
                </span>
              </div>
              {stack.steps.map((s) => (
                <div key={s.factorKey} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="text-[13.5px]">
                      <span className="text-[var(--muted)]">× </span>
                      {s.level}
                    </span>
                    <span className="mono block text-[11px] text-[var(--muted)]">
                      n={s.sampleSize}, {(s.closeRate * 100).toFixed(1)}% close,{" "}
                      {s.avgWonAmount !== null ? (
                        <>{money(s.avgWonAmount, currency)} avg won</>
                      ) : s.medianWonAmount !== null ? (
                        <>{money(s.medianWonAmount, currency)} median</>
                      ) : (
                        "-"
                      )}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-[14px] font-bold text-[var(--primary)]">
                    ×{s.multiplier}
                  </span>
                </div>
              ))}

              {stack.wasBounded && (
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-dashed border-[var(--border)] pt-2">
                  <span className="text-[12.5px] text-[var(--muted)]">
                    Bounded to {MAX_STACK_DEVIATION}× from base
                  </span>
                  <span className="mono text-[13px] text-[var(--muted)]">
                    ×{stack.stackMultiplier} → ×{stack.boundedMultiplier}
                  </span>
                </div>
              )}

              <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-[var(--border)] pt-2">
                <span className="text-[12.5px] text-[var(--muted)]">
                  Calibrated to your observed average
                  {editCount > 0 && " (after your edits)"}
                </span>
                <span className="mono text-[13px] text-[var(--muted)]">
                  ×{stack.calibrationFactor.toFixed(3)}
                </span>
              </div>

              <div className="mt-2 flex items-baseline justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--primary-soft)] px-3 py-2.5">
                <span className="text-[13.5px] font-bold text-[var(--primary-deep)]">
                  Highest value sent
                </span>
                <span className="mono text-[20px] font-extrabold tracking-tight text-[var(--primary-deep)]">
                  {money(stack.finalValue, currency, 2)}
                </span>
              </div>
            </div>

            {spread.recommendedCap !== null && (
              <p className="mt-3.5 border-t border-[var(--border)] pt-3 text-[12.5px] text-[var(--muted)]">
                Capped at{" "}
                <span className="mono font-semibold text-[var(--foreground)]">
                  {money(spread.recommendedCap, currency)}
                </span>{" "}
                ({spread.capMultiple}× your median won deal). Smart Bidding chases the
                largest values it sees, so one outlier would pull spend toward whatever
                resembled it. The cap would have clipped{" "}
                <span className="mono font-semibold text-[var(--foreground)]">
                  {spread.dealsAboveCap}
                </span>{" "}
                {spread.dealsAboveCap === 1 ? "deal" : "deals"} in this file.
              </p>
            )}
          </div>

          {/* Factors and their levels */}
          <div className="card overflow-hidden">
            <p className="label px-4 pb-1 pt-4 sm:px-5">
              Signals in the model · fitted on {model.fittedOn.toLocaleString()} resolved deals
            </p>
            <div className="mt-1">
              {model.includedFactors.map((f) => (
                <FactorRow
                  key={f.key}
                  factor={f}
                  currency={currency}
                  overrides={overrides}
                  onOverride={onOverride}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Worked examples from their own file */}
      {examples.length > 0 && (
        <div className="card mt-5 overflow-hidden p-0">
          <p className="label px-4 pb-2.5 pt-4 sm:px-5">
            Applied to your leads{editCount > 0 && " · updated with your edits"}
          </p>
          <div className="scroll-x">
            <table className="table min-w-[620px]">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>What drove the value</th>
                  <th className="num">Value sent</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((v) => (
                  <tr key={v.deal.id}>
                    <td className="mono text-[12px] text-[var(--muted)]">
                      {v.deal.email ?? v.deal.id}
                    </td>
                    <td>
                      {v.steps.length === 0 ? (
                        <span className="text-[12.5px] italic text-[var(--muted)]">
                          no priced signals - base value
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {v.steps.map((s) => (
                            <span
                              key={s.factorKey}
                              className="rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-0.5 text-[11.5px]"
                            >
                              {s.level}{" "}
                              <span className="mono text-[var(--muted)]">×{s.multiplier}</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="num text-[14px] font-bold">
                      {money(v.value, currency, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// PANEL 3 - wiring it up
// ---------------------------------------------------------------------------

export function WiringPanel({
  match,
  volume,
  verdict,
  onContinue,
}: {
  match: MatchRateReadiness;
  volume: VolumeCheck;
  verdict: Verdict;
  onContinue: () => void;
}) {
  const tone =
    verdict.mode === "MEASURED"
      ? "border-[var(--accent-line)] bg-[var(--accent-soft)]"
      : verdict.mode === "PREDICTED"
      ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
      : "border-[var(--warn-line)] bg-[var(--warn-soft)]";

  return (
    <section>
      <div className="mb-4">
        <h2 className="h2">Wiring it up</h2>
        <p className="mt-1.5 max-w-[72ch] text-[14px] text-[var(--muted)]">
          What has to be true before these values reach Google, and what to do next.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={
            "card p-5 " +
            (match.isTrackingGap ? "border-[var(--warn-line)] bg-[var(--warn-soft)]" : "")
          }
        >
          <p className="label">Match rate</p>
          <p className="mono mt-1 text-[26px] font-extrabold leading-none tracking-tight">
            {pct(match.overallRate)}
          </p>
          <p className="mt-1.5 max-w-[42ch] text-[13px] text-[var(--muted)]">
            {match.isTrackingGap ? (
              <>
                of your leads carry a click ID or usable email. Without one we cannot
                attach a value to the ad click - this is the first thing to fix.
              </>
            ) : (
              <>
                of your leads can be matched back to an ad click.{" "}
                {(match.totalRows - match.withAnyIdentifier).toLocaleString()} cannot and
                are simply left out.
              </>
            )}
          </p>
        </div>

        <div className="card p-5">
          <p className="label">Volume</p>
          <p className="mono mt-1 text-[26px] font-extrabold leading-none tracking-tight">
            {volume.leadsPerMonth}
            <span className="text-[14px] font-semibold text-[var(--muted)]">/mo</span>
          </p>
          <p className="mt-1.5 max-w-[42ch] text-[13px] text-[var(--muted)]">
            leads, and{" "}
            <span className="mono font-semibold text-[var(--foreground)]">
              {volume.wonDealsPerMonth}
            </span>{" "}
            resolved deals per month.{" "}
            {volume.leadVolumeSufficient
              ? "Enough for Smart Bidding to learn from value signals."
              : "Below the ~30/month Smart Bidding needs to learn from value."}
          </p>
        </div>
      </div>

      <div className={`mt-3.5 rounded-[var(--radius-lg)] border p-5 sm:p-6 ${tone}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono rounded-[var(--radius-sm)] bg-[var(--navy)] px-3 py-1.5 text-[11.5px] font-bold tracking-[.06em] text-[var(--on-navy)]">
            {verdict.mode.replace("_", " ")}
          </span>
          <p className="text-[15px] font-bold">{verdict.headline}</p>
        </div>
        <p className="mt-2 max-w-[74ch] text-[14px] text-[var(--muted)]">{verdict.reasoning}</p>

        {verdict.blockers.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {verdict.blockers.map((b, i) => (
              <li key={i} className="flex gap-2.5 rounded-[var(--radius-sm)] bg-[var(--surface)]/75 px-3.5 py-2.5 text-[13.5px] text-[var(--muted-strong)]">
                <span className="font-bold text-[var(--warn)]">!</span>
                {b}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onContinue} className="btn btn-primary">
            Send these values to Google Ads <ArrowIcon />
          </button>
          <span className="text-[12.5px] text-[var(--muted)]">
            Takes a couple of minutes, once
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The expander
// ---------------------------------------------------------------------------

export function AnalysisExpander({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="card card-hover flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <span>
          <span className="text-[15px] font-bold">See the full analysis</span>
          <span className="mt-0.5 block text-[13px] text-[var(--muted)]">
            What you said versus what your data says, cycle length, channel
            insight, data quality, and the signals that were tested and dropped.
          </span>
        </span>
        <span
          aria-hidden
          className={
            "flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary-deep)] transition-transform duration-[var(--base)] ease-[var(--ease)] " +
            (open ? "rotate-180" : "")
          }
        >
          ▾
        </span>
      </button>
      {open && (
        /* minmax(0,1fr): a grid item will not shrink below its min-content, so
           one wide table in here would push the phone sideways. */
        <div className="animate-block-enter mt-4 grid grid-cols-[minmax(0,1fr)] gap-8">
          {children}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dropped factors + attribution honesty (inside the expander)
// ---------------------------------------------------------------------------

export function DroppedFactorsSection({ model }: { model: ValueModel }) {
  // Factors the advertiser explicitly claimed get their own section, where the
  // claim is answered directly rather than listed as a technical rejection.
  const dropped = model.droppedFactors.filter((f) => f.userClaim === null);
  if (dropped.length === 0) return null;
  return (
    <section>
      <h3 className="h3 mb-3">Signals we tested and dropped</h3>
      <div className="grid gap-2">
        {dropped.map((f) => (
          <div key={f.key} className="card px-4 py-3">
            <p className="text-[13.5px] font-semibold">{f.label}</p>
            <p className="mt-0.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
              We tested it and {f.droppedReason}.
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Columns the engine would not touch, and why.
 *
 * A protected characteristic is refused before its shape is examined, so it
 * never appears in the tested list and could otherwise vanish without a
 * trace. An advertiser who uploaded an age band expecting it to matter
 * deserves to be told it was seen and set aside on purpose, rather than left
 * to wonder whether the tool missed it.
 */
export function RefusedColumnsSection({
  refused,
}: {
  refused: { column: string; reason: string }[];
}) {
  if (refused.length === 0) return null;
  return (
    <section>
      <h3 className="h3 mb-1">Columns we will not price on</h3>
      <p className="mb-3 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
        Seen in your file and left out on purpose, however strongly they might
        predict. Each one says why: either bidding differently on it is what
        Google&apos;s personalised advertising rules and discrimination law
        forbid, or it is written after the outcome is known and would never be
        there on a new lead.
      </p>
      <div className="grid gap-2">
        {refused.map((r) => (
          <div key={r.column} className="card px-4 py-3">
            <p className="mono text-[13px] font-semibold">{r.column}</p>
            <p className="mt-0.5 max-w-[74ch] text-[13px] text-[var(--muted)]">{r.reason}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Answers the claims made at intake, one by one, whether or not they survived.
 * A refuted claim is the most useful line in the report - it is the moment the
 * advertiser learns their own data disagrees with them.
 */
export function ClaimsTestedSection({ model }: { model: ValueModel }) {
  const claimed = model.factors.filter((f) => f.userClaim !== null);
  if (claimed.length === 0) return null;

  return (
    <section>
      <h3 className="h3 mb-1">What you said, tested</h3>
      <p className="mb-3 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
        Each of these came from your description. We fitted it against your own
        resolved deals under the same thresholds as everything else.
      </p>
      <div className="grid gap-2">
        {claimed.map((f) => {
          const verdict = judgeClaim(f);
          const tone =
            verdict.kind === "confirmed"
              ? {
                  border: "border-[var(--accent)]/40",
                  chip: "bg-[var(--accent-soft)] text-[var(--accent)]",
                  label: "Holds up",
                }
              : verdict.kind === "refuted"
                ? {
                    border: "border-[var(--warn)]/40",
                    chip: "bg-[var(--warn-soft)] text-[var(--warn)]",
                    label: "Not what your data says",
                  }
                : {
                    border: "border-[var(--border)]",
                    chip: "bg-[var(--background-deep)] text-[var(--muted)]",
                    label: "Couldn't test it",
                  };

          return (
            <div
              key={f.key}
              className={`rounded-xl border bg-[var(--surface)] px-4 py-3 ${tone.border}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold">
                  &ldquo;{f.userClaim}&rdquo;
                </p>
                <span
                  className={
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide " +
                    tone.chip
                  }
                >
                  {tone.label}
                </span>
              </div>

              <p className="mt-1 max-w-[74ch] text-[13px] text-[var(--muted-strong)]">
                {verdict.kind === "confirmed" && (
                  <>
                    <span className="mono">{verdict.level.level}</span> is worth{" "}
                    <span className="mono">{verdict.level.lift}×</span> the average lead
                    across <span className="mono">{verdict.level.sampleSize.toLocaleString()}</span>{" "}
                    resolved deals, so it prices your leads.
                  </>
                )}

                {verdict.kind === "refuted" && verdict.because === "factor-dropped" && (
                  <>
                    {f.label} did not hold up - {f.droppedReason}. We left it out rather
                    than bid on it.
                  </>
                )}

                {/*
                  The most valuable line the report can produce, and the one it
                  used to get backwards: the factor is real, the level they
                  named is not the good one. Saying "holds up" here told
                  somebody their theory was confirmed while showing them
                  evidence against it.
                */}
                {verdict.kind === "refuted" && verdict.because === "wrong-level" && (
                  <>
                    {f.label} does predict value, but not the way you said.{" "}
                    <span className="mono">{verdict.level?.level}</span> is worth{" "}
                    <span className="mono">{verdict.level?.lift}×</span> the average lead
                    across{" "}
                    <span className="mono">
                      {verdict.level?.sampleSize.toLocaleString()}
                    </span>{" "}
                    resolved deals.
                    {verdict.strongest && (
                      <>
                        {" "}
                        Your strongest is{" "}
                        <span className="mono">{verdict.strongest.level}</span> at{" "}
                        <span className="mono">{verdict.strongest.lift}×</span>.
                      </>
                    )}
                  </>
                )}

                {verdict.kind === "untested" && (
                  <>
                    We couldn&apos;t test that: {verdict.reason}. It is not pricing your
                    leads either way.
                  </>
                )}
              </p>

              {f.statedLevels.length > 0 && (
                <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                  You named{" "}
                  {f.statedLevels.map((l) => (
                    <span
                      key={l}
                      className="mono mr-1 inline-block rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px]"
                    >
                      {l}
                    </span>
                  ))}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Every deal the safety cap touched, named.
 *
 * The cap is the one place the product deliberately reports a number lower
 * than the truth, so the deals it clipped and the amount it clipped them by
 * have to be inspectable - otherwise it is exactly the kind of invisible
 * adjustment the rest of the product refuses to make.
 */
export function ClippedOutliersSection({
  deals,
  valued,
  spread,
  currency,
}: {
  deals: MappedDeal[];
  valued: ValuedLead[];
  spread: ValueSpread;
  currency: string;
}) {
  const cap = spread.recommendedCap;
  if (cap === null) return null;

  const clippedWon = deals
    .filter((d) => d.outcome === "won" && d.amount !== null && d.amount > cap)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  const clippedSends = valued.filter((v) => v.cappedFrom !== null);

  return (
    <section>
      <h3 className="h3 mb-1">What the safety cap clipped</h3>
      <p className="mb-3 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
        The cap sits at{" "}
        <span className="mono font-semibold text-[var(--foreground)]">
          {money(cap, currency)}
        </span>{" "}
        - {spread.capMultiple}× your median won deal. It exists because Smart Bidding
        chases the largest values it sees, so a single unusual deal would pull spend
        toward whatever superficially resembled it.
      </p>

      {clippedWon.length === 0 && clippedSends.length === 0 ? (
        <div className="card px-4 py-3">
          <p className="text-[13px] text-[var(--muted)]">
            Nothing in this file was above the cap. It is doing no work here - it is
            protection against the deal you have not closed yet.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-sunken)] text-[10.5px] uppercase tracking-[.07em] text-[var(--muted)]">
                <th className="px-4 py-2 font-bold">Deal</th>
                <th className="px-4 py-2 font-bold">Closed for</th>
                <th className="px-4 py-2 text-right font-bold">Counted as</th>
                <th className="px-4 py-2 text-right font-bold">Difference</th>
              </tr>
            </thead>
            <tbody>
              {clippedWon.slice(0, 25).map((d) => (
                <tr key={d.id} className="border-t border-[var(--border)]">
                  <td className="mono px-4 py-2.5 text-[12px] text-[var(--muted)]">
                    {d.email ?? d.id}
                  </td>
                  <td className="mono px-4 py-2.5 text-[13px] font-semibold">
                    {money(d.amount!, currency)}
                  </td>
                  <td className="mono px-4 py-2.5 text-right text-[13px]">
                    {money(cap, currency)}
                  </td>
                  <td className="mono px-4 py-2.5 text-right text-[13px] text-[var(--warn)]">
                    −{money(d.amount! - cap, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {clippedWon.length > 25 && (
            <p className="border-t border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--muted)]">
              Showing the 25 largest of{" "}
              <span className="mono">{clippedWon.length.toLocaleString()}</span> clipped
              deals.
            </p>
          )}
        </div>
      )}

      <p className="mt-2.5 text-[12.5px] text-[var(--muted)]">
        {clippedSends.length > 0 ? (
          <>
            The cap also clipped{" "}
            <span className="mono font-semibold text-[var(--foreground)]">
              {clippedSends.length.toLocaleString()}
            </span>{" "}
            of the values about to be sent to Google.
          </>
        ) : (
          <>
            No value about to be sent to Google reaches the cap - predicted values are
            expectations at lead creation, so they sit well below closed-deal amounts.
          </>
        )}
      </p>
    </section>
  );
}

/**
 * What a lead becomes worth once it proves itself.
 *
 * Every other number in the report is fixed the moment a lead arrives. This is
 * the one that moves - and it only counts if it moves fast enough, so the
 * window is stated alongside it rather than buried.
 */
export function EarlyGateSection({
  gate,
  currency,
}: {
  gate: GateValue;
  currency: string;
}) {
  if (!gate.stage && !gate.unusableReason) return null;

  return (
    <section>
      <div className="mb-4">
        <h2 className="h2">And one thing that can change it later</h2>
        <p className="mt-1.5 max-w-[72ch] text-[14px] text-[var(--muted)]">
          Everything above prices a lead on what is knowable the moment it
          arrives. Google stops accepting a new value for a conversion after 7
          days, so the only thing that can sharpen a price after that is a
          milestone the lead hits inside that week.
        </p>
      </div>

      {gate.available ? (
        <div className="card overflow-hidden p-0">
          {/*
            The headline figure gets the same weight as the day-0 stack's, but
            deliberately not the same box. Folding the gate into the rule stack
            would read as another arrival multiplier, and it is not one - it is
            an adjustment sent days later to a conversion Google already has.
          */}
          <div className="grid gap-5 border-b border-[var(--border)] bg-[var(--primary-softer)] p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 sm:p-6">
            <div>
              <p className="label">Reaching this stage is worth</p>
              <p className="mono mt-1.5 text-[2rem] leading-none font-extrabold tracking-tight text-[var(--primary-deep)]">
                ×{gate.multiplier}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-bold">
                <span className="mono">{gate.stage}</span>
              </p>
              <p className="mono mt-1 text-[12.5px] text-[var(--muted)]">
                {Math.round(gate.withinWindowRate * 100)}% of leads that get there
                do it inside the 7 days
              </p>
            </div>
          </div>

          <div className="grid gap-5 p-5 sm:p-6">
            {/* The evidence: two close rates side by side is the whole case for
                the multiplier, and it was previously a run-on sentence. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="well p-4">
                <p className="label">Reached {gate.stage}</p>
                <p className="mono mt-1.5 text-[1.35rem] font-bold text-[var(--accent)]">
                  {(gate.closeRateReached * 100).toFixed(1)}%
                </p>
                <p className="mono mt-1 text-[11.5px] text-[var(--muted)]">
                  close rate · n={gate.reachedCount.toLocaleString()}
                  {gate.medianWonReached !== null && (
                    <> · {money(gate.medianWonReached, currency)} median</>
                  )}
                </p>
              </div>
              <div className="well p-4">
                <p className="label">Did not reach it</p>
                <p className="mono mt-1.5 text-[1.35rem] font-bold text-[var(--muted-strong)]">
                  {(gate.closeRateNotReached * 100).toFixed(1)}%
                </p>
                <p className="mono mt-1 text-[11.5px] text-[var(--muted)]">
                  close rate · n={gate.notReachedCount.toLocaleString()}
                </p>
              </div>
            </div>

            {gate.wasBounded && gate.rawMultiplier !== null && (
              <div className="alert alert-warn">
                <p className="text-[13.5px] font-bold text-[var(--warn)]">
                  Measured at ×{gate.rawMultiplier}, held to ×{gate.multiplier}
                </p>
                <p className="mt-1 max-w-[72ch] text-[13px] text-[var(--muted-strong)]">
                  Leads that clear this gate both qualify more often and were
                  already priced up for the attributes that got them there, so
                  the full figure counts the same signal twice.
                </p>
              </div>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="flex gap-2.5">
                <span aria-hidden className="mt-[3px] shrink-0">
                  <span className="flex size-[18px] items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
                    ✓
                  </span>
                </span>
                <p className="text-[13px] text-[var(--muted-strong)]">
                  <span className="font-semibold text-[var(--foreground)]">
                    Reached in time.
                  </span>{" "}
                  We send Google a higher value for the conversion it already
                  has.
                </p>
              </div>
              <div className="flex gap-2.5">
                <span aria-hidden className="mt-[3px] shrink-0">
                  <span className="flex size-[18px] items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[11px] font-bold text-[var(--muted)]">
                    -
                  </span>
                </span>
                <p className="text-[13px] text-[var(--muted-strong)]">
                  <span className="font-semibold text-[var(--foreground)]">
                    Reached late.
                  </span>{" "}
                  We send nothing. Google discards a late adjustment, and
                  telling you we moved a bid we did not move would be worse than
                  saying nothing.
                </p>
              </div>
            </div>

            {/*
              The condition the rest of the report does not have.
              Every day-0 figure is computed once from the file in front of
              us and stays true. This one is not: it needs the lead's stage
              to be read again, inside the week, after this upload. A single
              CSV cannot do that for any lead that has not arrived yet, so a
              reader could see the multiplier, publish once, and reasonably
              believe their leads are being sharpened as they progress. They
              would not be. Saying so here costs nothing; leaving it out
              claims a bid we never moved.
            */}
            <div className="alert alert-warn">
              <p className="text-[13.5px] font-bold text-[var(--warn)]">
                Only if we are still reading your CRM when it happens
              </p>
              <p className="mt-1 max-w-[72ch] text-[13px] text-[var(--muted-strong)]">
                The stage change has to reach us inside the same 7 days, which
                means looking at your pipeline again after this file. A live
                CRM connection looks every night. A one-time upload cannot:
                leads that arrive after today are never seen again, so they
                keep the value they were given on arrival and this multiplier
                never fires for them. Connect your CRM, or upload a fresh
                export at least once a week.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-5 sm:p-6">
          <p className="text-[14px] font-bold">
            Nothing in this file can sharpen a lead&apos;s value in time
          </p>
          <p className="mt-1 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
            {gate.unusableReason}
          </p>
          <p className="mt-2.5 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
            Every lead keeps the value it was given on arrival. That is not a
            fault. It is what happens when a pipeline moves slower than the
            week Google gives you.
          </p>
        </div>
      )}
    </section>
  );
}

export function AttributionNote() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
      <p className="text-[13.5px] font-bold">How we treat your source data</p>
      <p className="mt-1 max-w-[76ch] text-[13.5px] leading-relaxed text-[var(--muted)]">
        Your CRM&apos;s source labels are used for channel insight only. They are not used
        to value your leads - attribution fields are frequently overwritten by later
        touches and are not reliable enough to price a conversion. Lead values here are
        derived only from attributes present when the lead arrived.
      </p>
    </div>
  );
}
