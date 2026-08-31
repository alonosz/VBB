import type { MappedDeal } from "./types";
import { median } from "./helpers";

/**
 * Did switching to value-based bidding actually work?
 *
 * The only question that matters after everything is wired up, and the one
 * nothing else in the market can answer honestly.
 *
 * Google will happily report that conversion value went up. That is circular:
 * we are the ones who told Google those values. Reporting it back as proof
 * would be quoting our own prediction as evidence for our own prediction.
 *
 * So this measures none of that. It compares the leads that arrived before the
 * switch against the ones that arrived after, on what actually happened to
 * them in the advertiser's CRM: did they close, and for how much. Real
 * outcomes, not our estimates of them. That needs both halves - the ad account
 * and the CRM - which is exactly why it is worth building.
 */

/**
 * Below this, a cohort is too small to say anything about.
 *
 * The same floor the value model uses for a factor level. A 40% swing on
 * eleven deals is noise wearing a percentage sign, and presenting it as a
 * result would be the most expensive kind of wrong: it would tell somebody to
 * keep paying for something that did nothing.
 */
export const MIN_COHORT = 25;

/**
 * How much of the sales cycle has to be behind us before a comparison means
 * anything. Judging a 60-day cycle after 30 days measures which cohort had
 * more time, not which cohort was better.
 */
export const CYCLE_COVERAGE_REQUIRED = 1.5;

export interface CohortOutcome {
  leads: number;
  /** Deals that have actually resolved, won or lost. The rest are still open. */
  resolved: number;
  won: number;
  closeRate: number;
  medianWonAmount: number | null;
  /** Expected value per lead: close rate times median won. */
  valuePerLead: number;
}

export type ProofVerdict =
  | { kind: "no-baseline" }
  | { kind: "too-early"; daysIn: number; daysNeeded: number }
  | { kind: "too-few"; before: number; after: number; needed: number }
  | {
      kind: "measured";
      before: CohortOutcome;
      after: CohortOutcome;
      /** Change in value per lead. 0.23 is 23% better. */
      change: number;
      improved: boolean;
    };

export function cohortOutcome(deals: MappedDeal[]): CohortOutcome {
  const resolved = deals.filter((d) => d.outcome === "won" || d.outcome === "lost");
  const won = resolved.filter((d) => d.outcome === "won");
  const closeRate = resolved.length > 0 ? won.length / resolved.length : 0;
  const medianWonAmount = median(
    won.map((d) => d.amount).filter((a): a is number => a !== null)
  );

  return {
    leads: deals.length,
    resolved: resolved.length,
    won: won.length,
    closeRate,
    medianWonAmount,
    // Priced the same way the model prices a cohort, so the two are
    // comparable and neither is a new invention.
    valuePerLead: medianWonAmount === null ? 0 : closeRate * medianWonAmount,
  };
}

export interface ProofInput {
  deals: MappedDeal[];
  /** When the advertiser switched to a value-based bid strategy. */
  switchedAt: Date | null;
  /** Their median days from lead to close, for the too-early check. */
  medianCycleDays: number;
  now?: Date;
}

/**
 * The comparison, or an honest reason there isn't one yet.
 *
 * Every refusal here is a case where a number could be produced and would
 * mislead. A cohort of eleven, or a 90-day cycle judged after three weeks,
 * both yield a confident-looking percentage that means nothing.
 */
export function didItWork(input: ProofInput): ProofVerdict {
  const now = input.now ?? new Date();
  if (!input.switchedAt) return { kind: "no-baseline" };

  const daysIn = Math.floor((now.getTime() - input.switchedAt.getTime()) / 86_400_000);
  const daysNeeded = Math.ceil(input.medianCycleDays * CYCLE_COVERAGE_REQUIRED);
  if (daysIn < daysNeeded) return { kind: "too-early", daysIn, daysNeeded };

  const switchTime = input.switchedAt.getTime();
  const dated = input.deals.filter((d) => d.createdAt !== null);
  const beforeDeals = dated.filter((d) => d.createdAt!.getTime() < switchTime);
  const afterDeals = dated.filter((d) => d.createdAt!.getTime() >= switchTime);

  const before = cohortOutcome(beforeDeals);
  const after = cohortOutcome(afterDeals);

  // Resolved deals, not leads: an unresolved lead tells us nothing about
  // whether it was a good one.
  if (before.resolved < MIN_COHORT || after.resolved < MIN_COHORT) {
    return { kind: "too-few", before: before.resolved, after: after.resolved, needed: MIN_COHORT };
  }

  const change =
    before.valuePerLead > 0 ? (after.valuePerLead - before.valuePerLead) / before.valuePerLead : 0;

  return { kind: "measured", before, after, change, improved: change > 0 };
}

/**
 * What this comparison cannot tell you.
 *
 * Shown next to the result, always. A before-and-after is not an experiment:
 * seasonality, a new landing page, a competitor leaving the auction and a
 * dozen other things land in the "after" bucket too. Saying so is what keeps
 * a genuine result trustworthy, and it is the difference between a measurement
 * and a marketing claim.
 */
export const PROOF_CAVEAT =
  "This compares two periods, not two groups running at the same time. Anything " +
  "else that changed since the switch - seasonality, your landing pages, who " +
  "else was bidding - is in these numbers too. For proof that rules those out, " +
  "run it as a campaign experiment in Google Ads, which splits traffic and " +
  "compares like with like.";
