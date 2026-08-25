import type { MappedDeal } from "./types";
import { median, round } from "./helpers";
import { applyCap } from "./valueSpread";
import { buildFactorList, type FactorDefinition } from "./factors";

/**
 * The value model: what one lead is worth on the day it arrives.
 *
 * Built only from lead-intrinsic attributes — things knowable at form-fill
 * time. The output is a short rule stack the advertiser can read, audit
 * against their own data, and hand to Google.
 */

export const MIN_LEVEL_SAMPLE = 25;
export const MIN_LIFT = 1.3;

/**
 * The furthest the whole stack may move a lead from the base value, in either
 * direction.
 *
 * Each lift is measured marginally, against the overall baseline, but the
 * factors overlap heavily — corporate email, company size and seniority
 * largely describe the same "real business buyer". Multiplying four of them
 * compounds that shared signal, and it compounds downward as hard as upward:
 * unbounded, a free-webmail IC at a tiny logistics firm lands near 0.02x base,
 * which tells Google the lead is worthless on evidence that does not support
 * that claim.
 *
 * Bounding the product keeps the ordering between segments intact while
 * refusing to state more confidence than marginal lifts can carry.
 */
export const MAX_STACK_DEVIATION = 8;

export interface FactorLevel {
  level: string;
  /** Resolved deals (won + lost) backing this level. */
  sampleSize: number;
  won: number;
  closeRate: number;
  medianWonAmount: number | null;
  expectedValue: number;
  /** expectedValue / baseline. 1 means no signal. */
  lift: number;
  /** False when the level fell under the sample floor. */
  usable: boolean;
}

export interface ModelFactor {
  key: string;
  label: string;
  levels: FactorLevel[];
  /** Strongest deviation from baseline in either direction. */
  strongestLift: number;
  included: boolean;
  /** Populated when the factor was tested and dropped. */
  droppedReason: string | null;
  /**
   * The advertiser's own claim about this factor, when they made one. A
   * hypothesis is reported whether it survives or not — being told "you said
   * ops directors are your buyers, and the data does not bear that out" is
   * worth more than a silent omission.
   */
  userClaim: string | null;
  /** The levels they said were good, in their words. */
  statedLevels: string[];
}

export interface RuleStackStep {
  factorKey: string;
  factorLabel: string;
  level: string;
  multiplier: number;
  sampleSize: number;
  closeRate: number;
  medianWonAmount: number | null;
}

export interface ValueModel {
  /** Overall expected value across all resolved leads. */
  baseValue: number;
  /** Rescales the stack so emitted values average back to reality. */
  calibrationFactor: number;
  cap: number | null;
  factors: ModelFactor[];
  includedFactors: ModelFactor[];
  droppedFactors: ModelFactor[];
  /** Dropped factors the advertiser had explicitly claimed mattered. */
  refutedClaims: ModelFactor[];
  /** True when nothing survived and every lead gets the base value. */
  isFlat: boolean;
  /** Resolved deals the model was fitted on. */
  fittedOn: number;
  currencyCode: string;
}

export interface ValuedLead {
  deal: MappedDeal;
  /** Steps that fired for this lead, in factor order. */
  steps: RuleStackStep[];
  /** Product of the steps, before the deviation bound. */
  stackMultiplier: number;
  /** After the deviation bound. */
  boundedMultiplier: number;
  wasBounded: boolean;
  rawValue: number;
  /** After calibration and cap — what actually gets sent. */
  value: number;
  cappedFrom: number | null;
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

function resolved(deals: MappedDeal[]): MappedDeal[] {
  return deals.filter((d) => d.outcome === "won" || d.outcome === "lost");
}

/** Expected value of a set of deals: close rate × median won amount. */
function expectedValueOf(deals: MappedDeal[]): { ev: number; closeRate: number; medianWon: number | null; won: number } {
  const won = deals.filter((d) => d.outcome === "won");
  const closeRate = deals.length > 0 ? won.length / deals.length : 0;
  const amounts = won.map((d) => d.amount).filter((a): a is number => a !== null);
  const medianWon = median(amounts);
  return {
    ev: medianWon === null ? 0 : closeRate * medianWon,
    closeRate,
    medianWon,
    won: won.length,
  };
}

export interface FactorHypothesis {
  factorKey: string;
  claim: string;
  statedLevels: string[];
}

function fitFactor(
  factor: FactorDefinition,
  pool: MappedDeal[],
  baseline: number,
  hypothesis: FactorHypothesis | null
): ModelFactor {
  const byLevel = new Map<string, MappedDeal[]>();
  for (const deal of pool) {
    const level = factor.levelOf(deal);
    if (level === null) continue;
    const bucket = byLevel.get(level);
    if (bucket) bucket.push(deal);
    else byLevel.set(level, [deal]);
  }

  const levels: FactorLevel[] = [];
  for (const [level, group] of byLevel) {
    const { ev, closeRate, medianWon, won } = expectedValueOf(group);
    const usable = group.length >= MIN_LEVEL_SAMPLE;
    levels.push({
      level,
      sampleSize: group.length,
      won,
      closeRate: round(closeRate, 4),
      medianWonAmount: medianWon,
      expectedValue: round(ev),
      lift: baseline > 0 ? round(ev / baseline, 3) : 1,
      usable,
    });
  }

  levels.sort((a, b) => b.lift - a.lift);

  const usableLevels = levels.filter((l) => l.usable);

  // Two-sided: a level at 0.4x is as informative as one at 2.5x. Testing only
  // the upside would discard "free webmail rarely converts", which is exactly
  // the kind of signal worth pricing.
  const strongestLift = usableLevels.reduce((best, l) => {
    const deviation = l.lift > 0 ? Math.max(l.lift, 1 / l.lift) : 1;
    return Math.max(best, deviation);
  }, 1);

  let droppedReason: string | null = null;
  if (usableLevels.length === 0) {
    droppedReason = `No level had ${MIN_LEVEL_SAMPLE}+ resolved deals behind it`;
  } else if (usableLevels.length < 2) {
    droppedReason = "Only one level had enough data, so there is nothing to compare against";
  } else if (strongestLift < MIN_LIFT) {
    droppedReason = `Strongest level moved value by only ${round(strongestLift, 2)}x — below the ${MIN_LIFT}x threshold, so it would add noise rather than signal`;
  }

  return {
    key: factor.key,
    label: factor.label,
    levels,
    strongestLift: round(strongestLift, 3),
    included: droppedReason === null,
    droppedReason,
    userClaim: hypothesis?.claim ?? null,
    statedLevels: hypothesis?.statedLevels ?? [],
  };
}

export interface BuildValueModelOptions {
  deals: MappedDeal[];
  cap: number | null;
  currencyCode: string;
  /** Extra mapped columns to test as value signals. */
  customSignalKeys?: string[];
  /** User overrides, keyed "factorKey::level". */
  overrides?: Record<string, number>;
  /** Claims from the intake step, attached to the factor that can test them. */
  hypotheses?: FactorHypothesis[];
}

export function buildValueModel(opts: BuildValueModelOptions): ValueModel {
  const { cap, currencyCode, customSignalKeys = [], hypotheses = [] } = opts;
  const pool = resolved(opts.deals);

  const { ev: baseValue } = expectedValueOf(pool);

  const claimFor = new Map(hypotheses.map((h) => [h.factorKey, h]));
  const factors = buildFactorList(customSignalKeys).map((f) =>
    fitFactor(f, pool, baseValue, claimFor.get(f.key) ?? null)
  );

  const includedFactors = factors.filter((f) => f.included);
  const droppedFactors = factors.filter((f) => !f.included);

  const model: ValueModel = {
    baseValue: round(baseValue),
    calibrationFactor: 1,
    cap,
    factors,
    includedFactors,
    droppedFactors,
    refutedClaims: droppedFactors.filter((f) => f.userClaim !== null),
    isFlat: includedFactors.length === 0 || baseValue <= 0,
    fittedOn: pool.length,
    currencyCode,
  };

  model.calibrationFactor = computeCalibration(model, pool, opts.overrides);
  return model;
}

/**
 * Multiplying marginal lifts double-counts correlated factors — a Director at
 * a 500-person company almost certainly has a corporate email, so the same
 * underlying "real business buyer" signal gets counted three times. Left
 * uncorrected the stack inflates every value, and Smart Bidding overbids.
 *
 * Rather than assume independence, we rescale the whole stack by a single
 * constant so the volume-weighted average of emitted values matches the
 * expected value actually observed in the data. Relative ordering between
 * segments is preserved; the portfolio can't drift from reality.
 */
function computeCalibration(
  model: ValueModel,
  pool: MappedDeal[],
  overrides?: Record<string, number>
): number {
  if (model.isFlat || pool.length === 0) return 1;

  let total = 0;
  for (const deal of pool) {
    total += rawValueFor(deal, model, overrides);
  }
  const meanRaw = total / pool.length;
  if (meanRaw <= 0) return 1;

  return round(model.baseValue / meanRaw, 6);
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

function multiplierFor(
  factor: ModelFactor,
  level: string,
  overrides?: Record<string, number>
): number | null {
  const override = overrides?.[`${factor.key}::${level}`];
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  const found = factor.levels.find((l) => l.level === level);
  if (!found || !found.usable) return null;
  return found.lift;
}

/**
 * Re-runs calibration after the user has edited multipliers.
 *
 * Calibration is the promise that the volume-weighted average of emitted
 * values matches the expected value actually observed. Editing a multiplier
 * without redoing it would quietly break that promise — the ordering between
 * leads would follow the edit, but the portfolio would drift away from
 * reality and Smart Bidding would over- or under-bid across the board.
 *
 * Every edited value therefore moves the calibration constant too, which is
 * shown in the rule stack rather than hidden.
 */
export function withOverrides(
  model: ValueModel,
  deals: MappedDeal[],
  overrides: Record<string, number>
): ValueModel {
  if (Object.keys(overrides).length === 0) return model;
  const next: ValueModel = { ...model, calibrationFactor: 1 };
  next.calibrationFactor = computeCalibration(next, resolved(deals), overrides);
  return next;
}

/** The multiplier in force for a level: the user's edit, or what we fitted. */
export function effectiveMultiplier(
  factorKey: string,
  level: FactorLevel,
  overrides?: Record<string, number>
): number {
  const o = overrides?.[`${factorKey}::${level.level}`];
  return typeof o === "number" && Number.isFinite(o) && o > 0 ? o : level.lift;
}

export function overrideKey(factorKey: string, level: string): string {
  return `${factorKey}::${level}`;
}

/** Product of every multiplier that fires, bounded to the deviation limit. */
export function clampStack(product: number): number {
  const lo = 1 / MAX_STACK_DEVIATION;
  return Math.min(MAX_STACK_DEVIATION, Math.max(lo, product));
}

function rawValueFor(
  deal: MappedDeal,
  model: ValueModel,
  overrides?: Record<string, number>
): number {
  const factorDefs = buildFactorList(
    model.factors.filter((f) => !isCoreKey(f.key)).map((f) => f.key)
  );

  let product = 1;
  for (const factor of model.includedFactors) {
    const def = factorDefs.find((d) => d.key === factor.key);
    if (!def) continue;
    const level = def.levelOf(deal);
    if (level === null) continue;
    const mult = multiplierFor(factor, level, overrides);
    if (mult === null) continue;
    product *= mult;
  }
  return model.baseValue * clampStack(product);
}

const CORE_KEYS = new Set(["domainType", "employeeBand", "industry", "seniority"]);
function isCoreKey(key: string): boolean {
  return CORE_KEYS.has(key);
}

/**
 * Values one lead, returning the steps that fired so the number can be traced
 * back to the rows it came from.
 */
export function valueLead(
  deal: MappedDeal,
  model: ValueModel,
  overrides?: Record<string, number>
): ValuedLead {
  const steps: RuleStackStep[] = [];
  const factorDefs = buildFactorList(
    model.factors.filter((f) => !isCoreKey(f.key)).map((f) => f.key)
  );

  let product = 1;

  for (const factor of model.includedFactors) {
    const def = factorDefs.find((d) => d.key === factor.key);
    if (!def) continue;
    const level = def.levelOf(deal);
    if (level === null) continue;

    const mult = multiplierFor(factor, level, overrides);
    if (mult === null) continue;

    const stats = factor.levels.find((l) => l.level === level)!;
    steps.push({
      factorKey: factor.key,
      factorLabel: factor.label,
      level,
      multiplier: mult,
      sampleSize: stats.sampleSize,
      closeRate: stats.closeRate,
      medianWonAmount: stats.medianWonAmount,
    });
    product *= mult;
  }

  const bounded = clampStack(product);
  const value = model.baseValue * bounded;

  const rawValue = round(value, 2);
  const calibrated = round(value * model.calibrationFactor, 2);
  const capped = applyCap(calibrated, model.cap);

  return {
    deal,
    steps,
    stackMultiplier: round(product, 3),
    boundedMultiplier: round(bounded, 3),
    wasBounded: round(bounded, 3) !== round(product, 3),
    rawValue,
    value: round(capped ?? calibrated, 2),
    cappedFrom: capped !== null && capped < calibrated ? calibrated : null,
  };
}

/** Values every lead, for previews and export. */
export function valueAllLeads(
  deals: MappedDeal[],
  model: ValueModel,
  overrides?: Record<string, number>
): ValuedLead[] {
  return deals.map((d) => valueLead(d, model, overrides));
}

/**
 * The worked example shown in the UI: the highest-value combination the model
 * can actually produce, with every multiplier traceable.
 */
export interface ExampleStack {
  baseValue: number;
  steps: RuleStackStep[];
  stackMultiplier: number;
  boundedMultiplier: number;
  wasBounded: boolean;
  calibrationFactor: number;
  beforeCap: number;
  cap: number | null;
  finalValue: number;
}

export function bestCaseStack(
  model: ValueModel,
  overrides?: Record<string, number>
): ExampleStack {
  const steps: RuleStackStep[] = [];
  let product = 1;

  for (const factor of model.includedFactors) {
    // Sorted by fitted lift, but an edit can change which level is strongest,
    // so the best case is chosen on the multiplier actually in force.
    const best = factor.levels
      .filter((l) => l.usable)
      .reduce<FactorLevel | null>((top, l) => {
        if (!top) return l;
        return effectiveMultiplier(factor.key, l, overrides) >
          effectiveMultiplier(factor.key, top, overrides)
          ? l
          : top;
      }, null);
    if (!best) continue;
    const multiplier = effectiveMultiplier(factor.key, best, overrides);
    steps.push({
      factorKey: factor.key,
      factorLabel: factor.label,
      level: best.level,
      multiplier,
      sampleSize: best.sampleSize,
      closeRate: best.closeRate,
      medianWonAmount: best.medianWonAmount,
    });
    product *= multiplier;
  }

  const bounded = clampStack(product);
  const beforeCap = round(model.baseValue * bounded * model.calibrationFactor, 2);
  const final = applyCap(beforeCap, model.cap) ?? beforeCap;

  return {
    baseValue: model.baseValue,
    steps,
    stackMultiplier: round(product, 3),
    boundedMultiplier: round(bounded, 3),
    wasBounded: round(bounded, 3) !== round(product, 3),
    calibrationFactor: model.calibrationFactor,
    beforeCap,
    cap: model.cap,
    finalValue: round(final, 2),
  };
}
