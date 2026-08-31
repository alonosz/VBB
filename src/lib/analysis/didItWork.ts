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

/**
 * Which leads Google's bidding could possibly have changed.
 *
 * A click ID is proof: the lead arrived through a Google ad click. A source
 * label is the CRM's own word for it, and only counted where it names Google
 * outright - "cpc" and "paid search" are Bing too, and a Bing lead sitting in
 * the control group is harmless where a Bing lead counted as Google is not.
 * The error this makes is the safe one: a missed Google lead dilutes the
 * control and understates the difference, rather than inventing one.
 */
const GOOGLE_SOURCE = /google|adwords|\bgads\b/i;

export function isGoogleSourced(deal: MappedDeal): boolean {
  if (deal.clickId?.trim()) return true;
  return GOOGLE_SOURCE.test(deal.source ?? "");
}

export interface CohortPair {
  before: CohortOutcome;
  after: CohortOutcome;
  /** Change in value per lead. 0.23 is 23% better. */
  change: number;
}

/** How many times the shuffle test re-deals the file. */
export const CHANCE_SHUFFLES = 1_000;

/**
 * Below this share of shuffles, a gap is treated as unlikely to be luck.
 *
 * The conventional 5%, and shown as a raw count ("41 of 1,000 shuffles")
 * rather than hidden behind the word significant, so the reader can apply
 * their own standard to the same number.
 */
export const CHANCE_THRESHOLD = 0.05;

/**
 * How often luck alone produces a gap this large.
 *
 * The first question any analyst asks of a before-and-after is "or is that
 * noise?", and answering it does not need a model: deal the same file's own
 * deals into "before" and "after" at random, over and over, and count how
 * often the shuffled gap matches the real one. Every shuffle uses only the
 * customer's own rows - nothing is simulated, assumed, or drawn from a
 * distribution somebody chose.
 *
 * Seeded, so the same file always reports the same count. A number that
 * changed on refresh would read as a slot machine.
 */
export interface ChanceCheck {
  shuffles: number;
  /** Shuffles whose gap was at least as large as the real one, either way. */
  asExtreme: number;
  /** asExtreme / shuffles. */
  pValue: number;
  unlikelyChance: boolean;
}

/**
 * The gap, in money, across the Google leads it was measured on.
 *
 * A percentage does not survive a renewal meeting; "about $46,000 more closed
 * revenue than the market trend accounts for" does. Counted only over
 * *resolved* Google leads since the switch - open leads have not said what
 * they are worth yet - and against a counterfactual in which Google's leads
 * had only followed the control group's trend.
 */
export interface AttributableWorth {
  /** What a Google lead would be worth had it merely followed the control. */
  counterfactualPerLead: number;
  /** Per resolved Google lead, beyond that. Negative when it fell behind. */
  perLead: number;
  resolvedSince: number;
  total: number;
}

/**
 * The comparison that survives an objection.
 *
 * A before-and-after on its own is not evidence: seasonality, a new landing
 * page, a better salesperson and a competitor leaving the auction all land in
 * the "after" bucket. But every one of those hits the leads that never came
 * from Google too - and Google's bid strategy cannot touch those. So they are
 * a control group the advertiser already owns.
 *
 * Google improved 28% while everything else improved 26% means we did nothing.
 * Google improved 28% while everything else fell 4% is a result. The gap is
 * the part worth claiming, and it is the only part we do claim.
 */
export type ControlVerdict =
  | {
      kind: "controlled";
      google: CohortPair;
      other: CohortPair;
      /** google.change - other.change. What the switch plausibly did. */
      attributable: number;
      improved: boolean;
      /** Null when the before-cohort closed nothing, leaving nothing to project. */
      worth: AttributableWorth | null;
      chance: ChanceCheck;
    }
  | { kind: "no-control"; reason: string };

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
      /** Google's leads against the ones it never touched. */
      control: ControlVerdict;
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

  const { before, after, change } = cohortPair(dated, switchTime);

  // Resolved deals, not leads: an unresolved lead tells us nothing about
  // whether it was a good one.
  if (before.resolved < MIN_COHORT || after.resolved < MIN_COHORT) {
    return { kind: "too-few", before: before.resolved, after: after.resolved, needed: MIN_COHORT };
  }

  return {
    kind: "measured",
    before,
    after,
    change,
    improved: change > 0,
    control: controlFor(dated, switchTime),
  };
}

/** One cohort split at the switch, and what happened between the halves. */
export function cohortPair(dated: MappedDeal[], switchTime: number): CohortPair {
  const before = cohortOutcome(dated.filter((d) => d.createdAt!.getTime() < switchTime));
  const after = cohortOutcome(dated.filter((d) => d.createdAt!.getTime() >= switchTime));
  const change =
    before.valuePerLead > 0 ? (after.valuePerLead - before.valuePerLead) / before.valuePerLead : 0;
  return { before, after, change };
}

/**
 * Google's leads against everything else, when both halves are big enough.
 *
 * Refused rather than approximated. A control group of nine is not a control
 * group, and an attributable figure computed from one would be the most
 * confident wrong number on the screen. Plenty of advertisers are entirely
 * Google-sourced and will never have one; they get the plain before-and-after
 * with its caveat, which is the honest answer for them.
 */
export function controlFor(dated: MappedDeal[], switchTime: number): ControlVerdict {
  const googleDeals = dated.filter(isGoogleSourced);
  const otherDeals = dated.filter((d) => !isGoogleSourced(d));

  const google = cohortPair(googleDeals, switchTime);
  const other = cohortPair(otherDeals, switchTime);

  const thin = (pair: CohortPair) =>
    pair.before.resolved < MIN_COHORT || pair.after.resolved < MIN_COHORT;

  if (thin(google)) {
    return {
      kind: "no-control",
      reason:
        "Not enough resolved leads that came from a Google ad to measure them " +
        "on their own yet.",
    };
  }
  if (thin(other)) {
    return {
      kind: "no-control",
      reason:
        "Almost everything in your CRM came from Google, so there is no group " +
        "the bid change could not have touched to compare against.",
    };
  }

  const attributable = google.change - other.change;

  /*
   * Money before percentages. The counterfactual Google lead is one that only
   * rode the same trend the control did; everything above that, across the
   * resolved Google leads since the switch, is the part the switch can claim.
   */
  let worth: AttributableWorth | null = null;
  if (google.before.valuePerLead > 0) {
    const counterfactualPerLead = round2(google.before.valuePerLead * (1 + other.change));
    const perLead = round2(google.after.valuePerLead - counterfactualPerLead);
    worth = {
      counterfactualPerLead,
      perLead,
      resolvedSince: google.after.resolved,
      total: round2(perLead * google.after.resolved),
    };
  }

  return {
    kind: "controlled",
    google,
    other,
    attributable,
    improved: attributable > 0,
    worth,
    chance: chanceCheck(googleDeals, otherDeals, switchTime, attributable),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Same generator the demo dataset uses; small, fast, and reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** The change a random before/after split of this pool produces. */
function shuffledChange(pool: MappedDeal[], beforeCount: number): number {
  const before = cohortOutcome(pool.slice(0, beforeCount));
  const after = cohortOutcome(pool.slice(beforeCount));
  return before.valuePerLead > 0
    ? (after.valuePerLead - before.valuePerLead) / before.valuePerLead
    : 0;
}

/**
 * Deal the file's own deals into before and after at random, CHANCE_SHUFFLES
 * times, and count how often luck alone produces a gap at least this large.
 *
 * Only resolved deals take part, because only resolved deals carry an
 * outcome - the same rule every other number on the screen follows. Shuffling
 * both groups erases any real timing effect, so the shuffled gaps show what
 * pure luck looks like on exactly this data, at exactly these sample sizes.
 */
export function chanceCheck(
  googleDeals: MappedDeal[],
  otherDeals: MappedDeal[],
  switchTime: number,
  observedGap: number
): ChanceCheck {
  const rand = mulberry32(20_260_831);

  const resolvedOf = (deals: MappedDeal[]) =>
    deals.filter((d) => d.outcome === "won" || d.outcome === "lost");
  const googlePool = resolvedOf(googleDeals);
  const otherPool = resolvedOf(otherDeals);
  const googleBefore = googlePool.filter((d) => d.createdAt!.getTime() < switchTime).length;
  const otherBefore = otherPool.filter((d) => d.createdAt!.getTime() < switchTime).length;

  let asExtreme = 0;
  const bar = Math.abs(observedGap);
  for (let i = 0; i < CHANCE_SHUFFLES; i++) {
    shuffleInPlace(googlePool, rand);
    shuffleInPlace(otherPool, rand);
    const gap = shuffledChange(googlePool, googleBefore) - shuffledChange(otherPool, otherBefore);
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

/**
 * What this comparison cannot tell you.
 *
 * Shown next to the result, always. A before-and-after is not an experiment:
 * seasonality, a new landing page, a competitor leaving the auction and a
 * dozen other things land in the "after" bucket too. Saying so is what keeps
 * a genuine result trustworthy, and it is the difference between a measurement
 * and a marketing claim.
 */
/**
 * What a controlled comparison still cannot tell you.
 *
 * Much shorter than the uncontrolled one, because the control has already
 * absorbed most of it. What survives is that Google's leads and everybody
 * else's are not interchangeable populations.
 */
export const CONTROLLED_CAVEAT =
  "Leads that come from Google and leads that come from elsewhere are not the " +
  "same kind of buyer, so this is a strong signal rather than an experiment. " +
  "For proof, run a campaign experiment in Google Ads, which splits the same " +
  "traffic in two.";

export const PROOF_CAVEAT =
  "This compares two periods, not two groups running at the same time. Anything " +
  "else that changed since the switch - seasonality, your landing pages, who " +
  "else was bidding - is in these numbers too. For proof that rules those out, " +
  "run it as a campaign experiment in Google Ads, which splits traffic and " +
  "compares like with like.";
