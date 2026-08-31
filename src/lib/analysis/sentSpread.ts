/**
 * Do the values we are about to send actually differ from each other?
 *
 * The question that decides whether any of this can work, and it is knowable
 * on day one rather than after a sales cycle.
 *
 * Smart Bidding acts on the *difference* between one lead's value and the
 * next. Send every lead the same figure and Maximize Conversion Value becomes
 * arithmetically identical to Maximize Conversions: the same ranking, the same
 * spend, the same leads. Not worse - identical, and pointless. A model that
 * prices every lead at $412 has produced a number, not a signal.
 *
 * So this is a refusal as much as a measurement. An advertiser whose data
 * cannot separate a good lead from a bad one is better off being told that in
 * week one than discovering it in month three, and the honest version of this
 * product says so rather than shipping a flat feed and hoping.
 */

/**
 * Almost everybody on one figure is flat, whatever the arithmetic says.
 *
 * A handful of outliers can pull a ratio up while 95% of the file sits on the
 * same number, and the ratio would call that healthy. What Google sees is one
 * value.
 */
export const FLAT_TOP_SHARE = 0.9;

/**
 * Below this the top decile is not meaningfully worth more than the bottom.
 *
 * Bidding is an auction: a 20% difference in value is inside the noise of what
 * a click costs, so it moves nothing an advertiser would notice. Twofold is
 * where the strategy has something to act on.
 */
export const WORKABLE_RATIO = 2;

export type SpreadVerdict = "flat" | "narrow" | "workable";

export interface SentSpread {
  leads: number;
  /** How many different figures Google would receive. */
  distinct: number;
  p10: number;
  p50: number;
  p90: number;
  /** p90 / p10. How much more the top decile is worth than the bottom. */
  ratio: number | null;
  /** Share of leads sitting on the single commonest value. */
  topShare: number;
  verdict: SpreadVerdict;
  /** The finding in one sentence, for the screen. */
  because: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** Null when there is nothing priced, because a spread of nothing is not zero. */
export function sentValueSpread(values: number[]): SentSpread | null {
  const priced = values.filter((v) => Number.isFinite(v) && v > 0);
  if (priced.length === 0) return null;

  const sorted = [...priced].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const v of priced) counts.set(v, (counts.get(v) ?? 0) + 1);
  const commonest = Math.max(...counts.values());

  const p10 = percentile(sorted, 0.1);
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const ratio = p10 > 0 ? p90 / p10 : null;
  const topShare = commonest / priced.length;
  const distinct = counts.size;

  let verdict: SpreadVerdict;
  let because: string;

  if (distinct === 1) {
    verdict = "flat";
    because =
      "Every lead is worth the same amount, so bidding on value would buy " +
      "exactly the same leads as bidding on volume.";
  } else if (topShare >= FLAT_TOP_SHARE) {
    verdict = "flat";
    because =
      `${Math.round(topShare * 100)}% of your leads carry the same value, so ` +
      "there is almost nothing for Google to tell apart.";
  } else if (ratio === null || ratio < WORKABLE_RATIO) {
    verdict = "narrow";
    because =
      "Your best leads are worth more than your worst, but not by much. " +
      "Expect a small shift in who Google buys, not a large one.";
  } else {
    verdict = "workable";
    because =
      `Your best leads are worth ${(ratio as number).toFixed(1)}x your worst. ` +
      "That is a difference Google can bid on.";
  }

  return { leads: priced.length, distinct, p10, p50, p90, ratio, topShare, verdict, because };
}
