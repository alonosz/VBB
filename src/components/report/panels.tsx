"use client";

import { useState } from "react";
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
// PANEL 1 — the hook
// ---------------------------------------------------------------------------

export function HookPanel({
  spread,
  valued,
  currency,
}: {
  spread: ValueSpread;
  valued: ValuedLead[];
  currency: string;
}) {
  if (spread.sampleSize === 0 || spread.min === null || spread.max === null) {
    return null;
  }

  // Log-spaced buckets: realised deal values span orders of magnitude, so a
  // linear histogram would pile everything into the first bar.
  const values = valued.map((v) => v.value).filter((v) => v > 0).sort((a, b) => a - b);
  const BUCKETS = 18;
  const lo = Math.log(Math.max(1, values[0] ?? 1));
  const hi = Math.log(Math.max(2, values[values.length - 1] ?? 2));
  const counts = new Array(BUCKETS).fill(0);
  for (const v of values) {
    const t = (Math.log(Math.max(1, v)) - lo) / Math.max(1e-9, hi - lo);
    counts[Math.min(BUCKETS - 1, Math.max(0, Math.floor(t * BUCKETS)))] += 1;
  }
  const peak = Math.max(...counts, 1);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-6 sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[.1em] text-[var(--muted)]">
        What your leads are worth
      </p>

      <h2 className="mt-3 max-w-[26ch] text-[clamp(24px,3.4vw,36px)] font-extrabold leading-[1.12] tracking-[-.025em] text-balance">
        Your leads range from{" "}
        <span className="mono">{money(spread.min, currency)}</span> to{" "}
        <span className="mono">{money(spread.max, currency)}</span> in real value
        {spread.blindnessRatio !== null && (
          <>
            {" ("}
            <span className="text-[var(--primary)]">{spread.blindnessRatio}×</span>
            {" spread)"}
          </>
        )}
        .
      </h2>
      <p className="mt-2.5 max-w-[52ch] text-[15px] text-[var(--muted)]">
        Google Ads currently treats every single one of them as identical.
      </p>

      {/* The realised range above is what deals turned out to be worth. This is
          a different quantity — what the model will actually send per lead —
          so it gets its own heading rather than sitting under the headline
          number and looking like a contradiction. */}
      <div className="mt-7 border-t border-[var(--border)] pt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[13.5px] font-bold">
            What your model will send instead
          </p>
          <p className="mono text-[13px] text-[var(--muted)]">
            {money(values[0] ?? 0, currency)} – {money(values.at(-1) ?? 0, currency)} per lead
          </p>
        </div>
        <div className="flex h-20 items-end gap-[3px]" role="img"
          aria-label={`Distribution of modelled lead values from ${money(values[0] ?? 0, currency)} to ${money(values.at(-1) ?? 0, currency)}`}>
          {counts.map((c, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[3px] bg-[var(--primary)] transition-all"
              style={{ height: `${Math.max(2, (c / peak) * 100)}%`, opacity: 0.35 + 0.65 * (i / BUCKETS) }}
            />
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[var(--muted)]">
          {values.length.toLocaleString()} leads, priced individually. The range is
          narrower than your realised deal values because a value is an expectation at
          lead creation, not a closed deal.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PANEL 2 — the value model
// ---------------------------------------------------------------------------

/**
 * One multiplier, editable.
 *
 * Marketers do not trust a number they cannot argue with, so every multiplier
 * is a field rather than a label — with the sample size, close rate and median
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
            ? "bg-[var(--primary-soft)] text-[var(--primary)]"
            : "bg-[#f1f3f8] text-[var(--muted)]")
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
            ? "border-[var(--warn)] bg-amber-50 text-amber-700"
            : "border-transparent bg-[var(--primary-soft)] text-[var(--primary)]")
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
    <div className="border-t border-[var(--border)] px-4 py-3.5 first:border-t-0">
      <p className="text-[13px] font-bold">{factor.label}</p>
      <div className="mt-2 grid gap-1.5">
        {usable.map((l) => (
          <div key={l.level} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-medium">{l.level}</span>
              <span className="mono text-[11.5px] text-[var(--muted)]">
                n={l.sampleSize} · {(l.closeRate * 100).toFixed(1)}% close ·{" "}
                {l.medianWonAmount !== null ? money(l.medianWonAmount, currency) : "—"} median
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
            {thin.map((l) => `${l.level} (n=${l.sampleSize})`).join(", ")} —{" "}
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
      <div className="mb-3.5">
        <h2 className="text-xl font-bold tracking-tight">Your value model</h2>
        <p className="mt-1 max-w-[72ch] text-[14px] text-[var(--muted)]">
          Built only from what is knowable the moment a lead arrives. Every multiplier
          comes from your own closed deals, and no number here is one you cannot trace
          back to rows in your file.{" "}
          {onOverride && <>Disagree with one? Type over it — the table below updates as you go.</>}
        </p>
      </div>

      {editCount > 0 && onResetAll && (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--warn)]/40 bg-amber-50/60 px-4 py-2.5">
          <p className="text-[13px]">
            <span className="font-semibold">
              {editCount} multiplier{editCount === 1 ? "" : "s"} edited.
            </span>{" "}
            <span className="text-[var(--muted)]">
              We rescaled the model to{" "}
              <span className="mono">×{model.calibrationFactor}</span> so your leads still
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
        <div className="rounded-2xl border border-amber-300/60 bg-amber-50/60 p-5">
          <p className="text-[14px] font-bold">
            No attribute in this file predicts value strongly enough to use.
          </p>
          <p className="mt-1 max-w-[72ch] text-[13.5px] text-[var(--muted)]">
            Every lead gets the same value —{" "}
            <span className="mono font-semibold text-[var(--foreground)]">
              {money(model.baseValue, currency)}
            </span>
            , your overall expected value per lead. That is still a real improvement on
            counting every form-fill as 1, but the signals tested below did not separate
            good leads from bad ones by enough to price differently.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          {/* The rule stack */}
          <div className="rounded-2xl border border-[var(--border)] bg-white p-5">
            <p className="label mb-3">The rule stack — best case</p>
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
                      {s.medianWonAmount !== null ? money(s.medianWonAmount, currency) : "—"} median
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
                  ×{stack.calibrationFactor}
                </span>
              </div>

              <div className="mt-1 flex items-baseline justify-between gap-3 border-t-2 border-[var(--foreground)]/15 pt-2.5">
                <span className="text-[13.5px] font-bold">Highest value sent</span>
                <span className="mono text-[19px] font-extrabold tracking-tight">
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
          <div className="rounded-2xl border border-[var(--border)] bg-white">
            <p className="label px-4 pb-1 pt-4">
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
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
          <p className="label px-4 pb-2 pt-4">
            Applied to your leads{editCount > 0 && " · updated with your edits"}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="bg-[#f8fafd] text-[10.5px] uppercase tracking-[.07em] text-[var(--muted)]">
                  <th className="px-4 py-2 font-bold">Lead</th>
                  <th className="px-4 py-2 font-bold">What drove the value</th>
                  <th className="px-4 py-2 text-right font-bold">Value sent</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((v) => (
                  <tr key={v.deal.id} className="border-t border-[var(--border)]">
                    <td className="mono px-4 py-2.5 text-[12px] text-[var(--muted)]">
                      {v.deal.email ?? v.deal.id}
                    </td>
                    <td className="px-4 py-2.5">
                      {v.steps.length === 0 ? (
                        <span className="text-[12.5px] italic text-[var(--muted)]">
                          no priced signals — base value
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {v.steps.map((s) => (
                            <span
                              key={s.factorKey}
                              className="rounded-full border border-[var(--border)] bg-[#f8fafd] px-2 py-0.5 text-[11.5px]"
                            >
                              {s.level}{" "}
                              <span className="mono text-[var(--muted)]">×{s.multiplier}</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="mono px-4 py-2.5 text-right text-[14px] font-bold">
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
// PANEL 3 — wiring it up
// ---------------------------------------------------------------------------

export function WiringPanel({
  match,
  volume,
  verdict,
  onExport,
  exportLabel,
  exportNote,
  children,
  footer,
}: {
  match: MatchRateReadiness;
  volume: VolumeCheck;
  verdict: Verdict;
  onExport: () => void;
  exportLabel: string;
  exportNote: string | null;
  /** Sits beside the download button. */
  children?: React.ReactNode;
  /** Full-width block below it — the scheduled feed, which is the real answer. */
  footer?: React.ReactNode;
}) {
  const tone =
    verdict.mode === "MEASURED"
      ? "border-emerald-300/60 bg-emerald-50/60"
      : verdict.mode === "PREDICTED"
      ? "border-[var(--primary)]/30 bg-[var(--primary-soft)]"
      : "border-amber-300/60 bg-amber-50/60";

  return (
    <section>
      <div className="mb-3.5">
        <h2 className="text-xl font-bold tracking-tight">Wiring it up</h2>
        <p className="mt-1 max-w-[72ch] text-[14px] text-[var(--muted)]">
          What has to be true before these values reach Google, and what to do next.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={
            "rounded-2xl border p-4 " +
            (match.isTrackingGap ? "border-amber-300/60 bg-amber-50/60" : "border-[var(--border)] bg-white")
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
                attach a value to the ad click — this is the first thing to fix.
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

        <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
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

      <div className={`mt-3 rounded-2xl border p-5 ${tone}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="mono rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-[11.5px] font-bold tracking-[.06em] text-white">
            {verdict.mode.replace("_", " ")}
          </span>
          <p className="text-[15px] font-bold">{verdict.headline}</p>
        </div>
        <p className="mt-2 max-w-[74ch] text-[14px] text-[var(--muted)]">{verdict.reasoning}</p>

        {verdict.blockers.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {verdict.blockers.map((b, i) => (
              <li key={i} className="flex gap-2.5 rounded-lg bg-white/70 px-3.5 py-2.5 text-[13.5px] text-[var(--muted)]">
                <span className="font-bold text-[var(--warn)]">!</span>
                {b}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onExport} className="btn btn-primary">
            {exportLabel}
          </button>
          {children}
        </div>
        {exportNote && (
          <p className="mono mt-2 text-[12px] text-[var(--muted)]">{exportNote}</p>
        )}
        {footer}
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
        className="flex w-full items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-white px-5 py-4 text-left transition-colors hover:border-[var(--primary)]/40"
      >
        <span>
          <span className="text-[15px] font-bold">See the full analysis</span>
          <span className="mt-0.5 block text-[13px] text-[var(--muted)]">
            Cycle length, channel insight, data quality, and the signals that were tested
            and dropped.
          </span>
        </span>
        <span className={"shrink-0 text-[var(--muted)] transition-transform " + (open ? "rotate-180" : "")}>
          ▾
        </span>
      </button>
      {open && <div className="animate-block-enter mt-4 grid gap-8">{children}</div>}
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
      <h3 className="mb-3 text-lg font-bold tracking-tight">Signals we tested and dropped</h3>
      <div className="grid gap-2">
        {dropped.map((f) => (
          <div key={f.key} className="rounded-xl border border-[var(--border)] bg-white px-4 py-3">
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
 * Answers the claims made at intake, one by one, whether or not they survived.
 * A refuted claim is the most useful line in the report — it is the moment the
 * advertiser learns their own data disagrees with them.
 */
export function ClaimsTestedSection({ model }: { model: ValueModel }) {
  const claimed = model.factors.filter((f) => f.userClaim !== null);
  if (claimed.length === 0) return null;

  return (
    <section>
      <h3 className="mb-1 text-lg font-bold tracking-tight">What you said, tested</h3>
      <p className="mb-3 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
        Each of these came from your description. We fitted it against your own
        resolved deals under the same thresholds as everything else.
      </p>
      <div className="grid gap-2">
        {claimed.map((f) => {
          const best = f.levels.filter((l) => l.usable)[0];
          return (
            <div
              key={f.key}
              className={
                "rounded-xl border bg-white px-4 py-3 " +
                (f.included ? "border-[var(--accent)]/40" : "border-[var(--border)]")
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold">
                  &ldquo;{f.userClaim}&rdquo;
                </p>
                <span
                  className={
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide " +
                    (f.included
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-[#eef1f7] text-[var(--muted)]")
                  }
                >
                  {f.included ? "In your model" : "Not in your model"}
                </span>
              </div>
              <p className="mt-1 max-w-[74ch] text-[13px] text-[var(--muted)]">
                {f.included && best ? (
                  <>
                    {f.label} holds up: <span className="mono">{best.level}</span> is worth{" "}
                    <span className="mono">{best.lift}×</span> the average lead across{" "}
                    <span className="mono">{best.sampleSize.toLocaleString()}</span>{" "}
                    resolved deals, so it prices your leads.
                  </>
                ) : (
                  <>
                    {f.label} did not hold up — {f.droppedReason}. We left it out
                    rather than bid on it.
                  </>
                )}
              </p>
              {f.statedLevels.length > 0 && (
                <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                  You named{" "}
                  {f.statedLevels.map((l) => (
                    <span
                      key={l}
                      className="mono mr-1 inline-block rounded-full border border-[var(--border)] bg-[#f8fafd] px-2 py-0.5 text-[11px]"
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
 * have to be inspectable — otherwise it is exactly the kind of invisible
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
      <h3 className="mb-1 text-lg font-bold tracking-tight">What the safety cap clipped</h3>
      <p className="mb-3 max-w-[74ch] text-[13.5px] text-[var(--muted)]">
        The cap sits at{" "}
        <span className="mono font-semibold text-[var(--foreground)]">
          {money(cap, currency)}
        </span>{" "}
        — {spread.capMultiple}× your median won deal. It exists because Smart Bidding
        chases the largest values it sees, so a single unusual deal would pull spend
        toward whatever superficially resembled it.
      </p>

      {clippedWon.length === 0 && clippedSends.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-3">
          <p className="text-[13px] text-[var(--muted)]">
            Nothing in this file was above the cap. It is doing no work here — it is
            protection against the deal you have not closed yet.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          <table className="w-full min-w-[480px] text-left text-[13px]">
            <thead>
              <tr className="bg-[#f8fafd] text-[10.5px] uppercase tracking-[.07em] text-[var(--muted)]">
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
            No value about to be sent to Google reaches the cap — predicted values are
            expectations at lead creation, so they sit well below closed-deal amounts.
          </>
        )}
      </p>
    </section>
  );
}

export function AttributionNote() {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[#f8fafd] p-5">
      <p className="text-[13.5px] font-bold">How we treat your source data</p>
      <p className="mt-1 max-w-[76ch] text-[13.5px] leading-relaxed text-[var(--muted)]">
        Your CRM&apos;s source labels are used for channel insight only. They are not used
        to value your leads — attribution fields are frequently overwritten by later
        touches and are not reliable enough to price a conversion. Lead values here are
        derived only from attributes present when the lead arrived.
      </p>
    </div>
  );
}
