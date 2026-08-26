import type { EarlyGateResult, MappedDeal } from "./types";
import { median, round } from "./helpers";
import { ADJUSTMENT_WINDOW_DAYS } from "./earlyGate";

/**
 * Pricing the early gate.
 *
 * Every other factor in the model is knowable the moment a lead arrives. This
 * one is not: it is knowable only once the lead has done something. That makes
 * it a different kind of signal, and it is only worth anything if it fires
 * before Google stops listening — a gate that typically trips on day twelve
 * cannot move a bid, however predictive it is.
 *
 * So the gate is priced separately from the day-0 stack, and refused outright
 * when it fires too late to matter.
 */

/** A gate needs this many deals on each side to be worth pricing. */
export const MIN_GATE_SAMPLE = 25;

/** Below this the gate says nothing the day-0 model did not already say. */
export const MIN_GATE_LIFT = 1.3;

/**
 * The furthest the gate may move a lead from its day-0 value.
 *
 * The lift is measured marginally, against the whole resolved population, but
 * the gate overlaps heavily with the day-0 factors — a lead with a corporate
 * email at a real company both qualifies more often *and* was already priced
 * up for it. Multiplying the two counts that shared signal twice.
 *
 * Bounding keeps the ordering intact while refusing to state more confidence
 * than a marginal comparison can carry. Combined with the day-0 stack bound, a
 * lead can move at most 8x from base on arrival and 4x again on the gate.
 */
export const MAX_GATE_MULTIPLIER = 4;

export interface GateValue {
  available: boolean;
  stage: string | null;
  /** Multiplier applied to a lead's day-0 value once it reaches the gate. */
  multiplier: number | null;
  reachedCount: number;
  notReachedCount: number;
  closeRateReached: number;
  closeRateNotReached: number;
  medianWonReached: number | null;
  /** Share of leads reaching the gate that do so inside Google's window. */
  withinWindowRate: number;
  /** Before the bound — shown so a clipped multiplier is never silent. */
  rawMultiplier: number | null;
  wasBounded: boolean;
  /** Plain-English reason, present whenever the gate cannot be used. */
  unusableReason: string | null;
}

const EMPTY: GateValue = {
  available: false, stage: null, multiplier: null,
  reachedCount: 0, notReachedCount: 0,
  closeRateReached: 0, closeRateNotReached: 0,
  medianWonReached: null, withinWindowRate: 0,
  rawMultiplier: null, wasBounded: false, unusableReason: null,
};

function expectedValue(deals: MappedDeal[]): { ev: number; closeRate: number; medianWon: number | null } {
  const won = deals.filter((d) => d.outcome === "won");
  const closeRate = deals.length > 0 ? won.length / deals.length : 0;
  const medianWon = median(won.map((d) => d.amount).filter((a): a is number => a !== null));
  return { ev: medianWon === null ? 0 : closeRate * medianWon, closeRate, medianWon };
}

/** Did this lead reach the gate, and how long did it take? */
export function reachedGate(deal: MappedDeal, stage: string): number | null {
  const days = deal.stageReachedAfterDays?.[stage];
  return typeof days === "number" && Number.isFinite(days) && days >= 0 ? days : null;
}

/**
 * Works out what reaching the gate is worth, as a multiplier on the day-0
 * value.
 *
 * Measured against leads that did *not* reach it, because that is the real
 * comparison: the question a bid needs answered is "is this lead now worth
 * more than one that looked identical yesterday and has since done nothing".
 */
export function gateValue(deals: MappedDeal[], gate: EarlyGateResult): GateValue {
  const stage = gate.recommended?.stage ?? null;
  if (!stage) {
    return {
      ...EMPTY,
      unusableReason:
        gate.message ??
        "No stage in this file fires reliably inside Google's 7-day window, so nothing can sharpen a lead's value in time.",
    };
  }

  const resolved = deals.filter((d) => d.outcome === "won" || d.outcome === "lost");
  const reached = resolved.filter((d) => reachedGate(d, stage) !== null);
  const notReached = resolved.filter((d) => reachedGate(d, stage) === null);

  const base = {
    ...EMPTY,
    stage,
    reachedCount: reached.length,
    notReachedCount: notReached.length,
    withinWindowRate: gate.recommended?.withinWindowRate ?? 0,
  };

  if (reached.length < MIN_GATE_SAMPLE || notReached.length < MIN_GATE_SAMPLE) {
    return {
      ...base,
      unusableReason: `Only ${reached.length} resolved deals reached "${stage}" and ${notReached.length} did not — too few on one side to price the difference.`,
    };
  }

  const hit = expectedValue(reached);
  const miss = expectedValue(notReached);
  // Measured against every resolved lead, not against the ones that never
  // qualified. Those barely close at all, so using them as the denominator
  // produces a multiplier in the dozens off a baseline near zero — arithmetic,
  // not evidence. The day-0 value is calibrated to the overall population, so
  // that is the population the gate has to be relative to.
  const overall = expectedValue(resolved);

  const priced = {
    ...base,
    closeRateReached: round(hit.closeRate, 4),
    closeRateNotReached: round(miss.closeRate, 4),
    medianWonReached: hit.medianWon,
  };

  if (overall.ev <= 0) {
    return {
      ...priced,
      unusableReason: `No resolved deal in this file has both an outcome and an amount, so there is no baseline to measure "${stage}" against.`,
    };
  }

  const raw = hit.ev / overall.ev;
  const multiplier = round(Math.min(raw, MAX_GATE_MULTIPLIER), 3);
  if (multiplier < MIN_GATE_LIFT) {
    return {
      ...priced,
      multiplier,
      unusableReason: `Reaching "${stage}" moves expected value by only ${multiplier}x — below the ${MIN_GATE_LIFT}x threshold, so an adjustment would be noise.`,
    };
  }

  return {
    ...priced,
    available: true,
    multiplier,
    rawMultiplier: round(raw, 3),
    wasBounded: raw > MAX_GATE_MULTIPLIER,
  };
}

export interface GateStatus {
  /** The lead has reached the gate. */
  reached: boolean;
  /** …and did so soon enough for Google to still act on it. */
  inTime: boolean;
  daysToReach: number | null;
}

/**
 * Whether a lead's gate has fired, and whether it fired in time.
 *
 * Both halves matter and they fail differently: a lead that never reached the
 * gate keeps its day-0 value, while one that reached it too late is a
 * recalibration input we must not pretend moved a bid.
 */
export function gateStatusFor(deal: MappedDeal, stage: string | null, now: Date): GateStatus {
  if (!stage) return { reached: false, inTime: false, daysToReach: null };

  const daysToReach = reachedGate(deal, stage);
  if (daysToReach === null) return { reached: false, inTime: false, daysToReach: null };

  // Two clocks have to agree: the lead reached the gate within the window, and
  // the window has not since closed on the original conversion.
  const ageDays = deal.createdAt
    ? (now.getTime() - deal.createdAt.getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY;

  return {
    reached: true,
    inTime: daysToReach < ADJUSTMENT_WINDOW_DAYS && ageDays < ADJUSTMENT_WINDOW_DAYS,
    daysToReach: round(daysToReach, 1),
  };
}
