import type { MappedDeal } from "./types";
import { monthsSpanned, mulberry32, round, shuffleInPlace } from "./helpers";
import { isGoogleSourced } from "./didItWork";
import { valueLead, type ValueModel } from "./valueModel";
import { CHANCE_SHUFFLES, CHANCE_THRESHOLD, type ChanceCheck } from "./didItWork";

/**
 * Is Google buying a different kind of lead than it used to?
 *
 * The outcome comparison is the honest end of the question and it is also
 * painfully slow. It waits for deals to close, so a realistic 10-15% effect
 * needs on the order of a thousand resolved deals per side before a
 * permutation test will call it anything but luck - a year, for an advertiser
 * closing seventy-five deals a month. A working system therefore reads as
 * "we cannot rule out chance" for most of the first year, which is true, and
 * useless to somebody deciding in March whether to keep paying.
 *
 * So measure the mechanism instead of the result. Value bidding does exactly
 * one thing: it makes the platform buy a different mix of leads. That mix is
 * observable the day a lead arrives - no waiting for it to close - which is
 * roughly four times the sample with none of the sales-cycle lag, on a
 * quantity whose variance is a fraction of realised revenue's. Effects
 * invisible for a year in outcomes are obvious in weeks here.
 *
 * What it is not: proof that the money arrived. It says the machine is doing
 * what it was installed to do. The outcome comparison remains the only thing
 * that says it paid, and this screen never lets one stand in for the other.
 *
 * On the circularity worry, which is the right worry to have: we are not
 * reading Google's reported conversion value back to the advertiser - that
 * would be quoting our own numbers as evidence for our own numbers. The
 * attributes here are CRM ground truth about who actually arrived, and the
 * model is a fixed yardstick applied identically to both cohorts. More
 * manufacturers turned up. That is a fact about the world, not about us.
 */

/** Below this many leads on either side, a share is not a trend. */
export const MIN_MIX_LEADS = 100;

/** How far a level's share must move to be worth naming, in points. */
export const NOTABLE_SHIFT = 0.02;

export interface LevelShift {
  factorKey: string;
  factorLabel: string;
  level: string;
  /** What the model says this level is worth, for reading the direction. */
  multiplier: number;
  beforeShare: number;
  afterShare: number;
  /** afterShare - beforeShare. Positive means Google buys more of these now. */
  shift: number;
}

export type MixVerdict =
  | { kind: "no-baseline" }
  | { kind: "too-few"; before: number; after: number; needed: number }
  | { kind: "flat-model"; reason: string }
  | {
      kind: "measured";
      googleBefore: number;
      googleAfter: number;
      /** Average model value of a Google lead, each side of the switch. */
      scoreBefore: number;
      scoreAfter: number;
      /** Relative change in that average. 0.12 is a 12% richer mix. */
      change: number;
      /** The same shift among leads Google never touched, when measurable. */
      controlChange: number | null;
      /** change - controlChange. Null when there is no usable control. */
      attributable: number | null;
      /** The levels that moved most, largest absolute shift first. */
      movers: LevelShift[];
      chance: ChanceCheck;
      pipeline: Pipeline;
    };

/**
 * Pipeline, which is the number a marketer is actually judged on.
 *
 * Everything else here is a rate - what one lead is worth. A rate does not go
 * in a board pack. "We added $180,000 of expected pipeline this quarter" does,
 * and unlike closed revenue it is knowable now, because a lead carries its
 * expected value the day it arrives rather than the day it closes.
 *
 * Expected is doing real work in that phrase. This is not the CRM's pipeline
 * figure, which sums every open deal at full sticker price and quietly assumes
 * they all close. Each lead here is already multiplied by how often its kind
 * actually closes for this advertiser, so the number is smaller than their CRM
 * says and very much likelier to arrive. Saying which one we mean, every time,
 * is the difference between a credible figure and one that gets torn apart the
 * first time somebody opens HubSpot beside it.
 *
 * Attribution holds volume constant on purpose. Pipeline also rises when
 * somebody raises the budget, and that was not us. Only the change in what a
 * lead is worth is claimed, multiplied by however many leads arrived.
 */
export interface Pipeline {
  /** Expected value of every Google lead since the switch. */
  createdSince: number;
  /** Per month, so windows of different lengths can be compared. */
  perMonthBefore: number;
  perMonthAfter: number;
  /** Above what the control trend would have produced. Null without a control. */
  attributable: number | null;
}

export interface MixShiftInput {
  deals: MappedDeal[];
  model: ValueModel;
  switchedAt: Date | null;
}

/** Average value the model puts on these leads. Zero for an empty set. */
function meanScore(deals: MappedDeal[], model: ValueModel): number {
  if (deals.length === 0) return 0;
  let total = 0;
  for (const deal of deals) total += valueLead(deal, model).value;
  return total / deals.length;
}

function relativeChange(before: number, after: number): number {
  return before > 0 ? (after - before) / before : 0;
}

export function mixShift(input: MixShiftInput): MixVerdict {
  if (!input.switchedAt) return { kind: "no-baseline" };

  /*
   * A model with no surviving factors prices every lead identically, so the
   * mix cannot move by construction. Saying that is more useful than
   * reporting a 0.0% shift that looks like a finding.
   */
  if (input.model.isFlat) {
    return {
      kind: "flat-model",
      reason:
        "Your model prices every lead the same, so there is no richer mix for " +
        "Google to shift towards.",
    };
  }

  const switchTime = input.switchedAt.getTime();
  const dated = input.deals.filter((d) => d.createdAt !== null);
  const google = dated.filter(isGoogleSourced);
  const other = dated.filter((d) => !isGoogleSourced(d));

  const split = (deals: MappedDeal[]) => ({
    before: deals.filter((d) => d.createdAt!.getTime() < switchTime),
    after: deals.filter((d) => d.createdAt!.getTime() >= switchTime),
  });

  const g = split(google);
  if (g.before.length < MIN_MIX_LEADS || g.after.length < MIN_MIX_LEADS) {
    return {
      kind: "too-few",
      before: g.before.length,
      after: g.after.length,
      needed: MIN_MIX_LEADS,
    };
  }

  const scoreBefore = meanScore(g.before, input.model);
  const scoreAfter = meanScore(g.after, input.model);
  const change = relativeChange(scoreBefore, scoreAfter);

  /*
   * The control again, for the same reason as everywhere else: a new landing
   * page changes who fills the form on every channel, and only the difference
   * between Google and everybody else is down to the bidding.
   */
  const o = split(other);
  const hasControl = o.before.length >= MIN_MIX_LEADS && o.after.length >= MIN_MIX_LEADS;
  const controlChange = hasControl
    ? relativeChange(meanScore(o.before, input.model), meanScore(o.after, input.model))
    : null;

  const totalBefore = scoreBefore * g.before.length;
  const totalAfter = scoreAfter * g.after.length;
  const monthsOf = (deals: MappedDeal[]) => monthsSpanned(deals.map((d) => d.createdAt!));

  /*
   * The counterfactual lead: one that only rode whatever the control did. The
   * gap between that and reality, across every lead that actually arrived, is
   * the pipeline the bid change can claim - and no more.
   */
  const counterfactualPerLead = scoreBefore * (1 + (controlChange ?? 0));
  const attributablePipeline =
    controlChange === null
      ? null
      : round((scoreAfter - counterfactualPerLead) * g.after.length);

  return {
    kind: "measured",
    googleBefore: g.before.length,
    googleAfter: g.after.length,
    pipeline: {
      createdSince: round(totalAfter),
      perMonthBefore: round(totalBefore / monthsOf(g.before)),
      perMonthAfter: round(totalAfter / monthsOf(g.after)),
      attributable: attributablePipeline,
    },
    scoreBefore: round(scoreBefore),
    scoreAfter: round(scoreAfter),
    change,
    controlChange,
    attributable: controlChange === null ? null : change - controlChange,
    movers: levelShifts(g.before, g.after, input.model),
    chance: mixChance(google, other, switchTime, input.model, change - (controlChange ?? 0)),
  };
}

/**
 * Which segments actually moved.
 *
 * The headline says the mix got richer; this says a marketer what changed -
 * "manufacturing went from 18% of your Google leads to 26%" is the sentence
 * they repeat to their boss, and it is checkable against their own CRM.
 */
function levelShifts(
  before: MappedDeal[],
  after: MappedDeal[],
  model: ValueModel
): LevelShift[] {
  const shifts: LevelShift[] = [];

  for (const factor of model.includedFactors) {
    const share = (deals: MappedDeal[], level: string) => {
      const priced = deals.filter((d) =>
        valueLead(d, model).steps.some((s) => s.factorKey === factor.key)
      );
      if (priced.length === 0) return null;
      const hits = priced.filter((d) =>
        valueLead(d, model).steps.some(
          (s) => s.factorKey === factor.key && s.level === level
        )
      );
      return hits.length / priced.length;
    };

    for (const level of factor.levels.filter((l) => l.usable)) {
      const b = share(before, level.level);
      const a = share(after, level.level);
      if (b === null || a === null) continue;
      shifts.push({
        factorKey: factor.key,
        factorLabel: factor.label,
        level: level.level,
        multiplier: level.lift,
        beforeShare: b,
        afterShare: a,
        shift: a - b,
      });
    }
  }

  return shifts
    .filter((s) => Math.abs(s.shift) >= NOTABLE_SHIFT)
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift));
}

/**
 * The same shuffle test the outcome comparison uses, on lead scores.
 *
 * Every lead carries a score the day it arrives, so this shuffles far more
 * rows than the outcome version can - which is the entire reason it can see
 * an effect the outcome test will not resolve for a year.
 */
function mixChance(
  google: MappedDeal[],
  other: MappedDeal[],
  switchTime: number,
  model: ValueModel,
  observedGap: number
): ChanceCheck {
  const rand = mulberry32(20_260_831);

  // Scored once. Shuffling the numbers is the same experiment as shuffling
  // the leads, and re-pricing a thousand times over would be slow enough to
  // stall the browser.
  const scoresOf = (deals: MappedDeal[]) => deals.map((d) => valueLead(d, model).value);
  const googleScores = scoresOf(google);
  const otherScores = scoresOf(other);
  const googleBefore = google.filter((d) => d.createdAt!.getTime() < switchTime).length;
  const otherBefore = other.filter((d) => d.createdAt!.getTime() < switchTime).length;

  const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
  const gapOf = (xs: number[], beforeCount: number) =>
    relativeChange(avg(xs.slice(0, beforeCount)), avg(xs.slice(beforeCount)));

  let asExtreme = 0;
  const bar = Math.abs(observedGap);
  for (let i = 0; i < CHANCE_SHUFFLES; i++) {
    shuffleInPlace(googleScores, rand);
    shuffleInPlace(otherScores, rand);
    const gap =
      gapOf(googleScores, googleBefore) -
      (otherScores.length > 0 ? gapOf(otherScores, otherBefore) : 0);
    if (Math.abs(gap) >= bar) asExtreme++;
  }

  const pValue = asExtreme / CHANCE_SHUFFLES;
  return {
    shuffles: CHANCE_SHUFFLES,
    asExtreme,
    pValue,
    unlikelyChance: pValue < CHANCE_THRESHOLD,
  };
}
