import type { MappedDeal, ValueSpread } from "./types";
import { quantile, round, wonWithAmount } from "./helpers";

/** Default cap multiple. A single whale otherwise dominates Smart Bidding. */
export const DEFAULT_CAP_MULTIPLE = 3;

/**
 * (f) Won-value distribution, the blindness ratio, and a recommended cap.
 *
 * The cap exists because Smart Bidding chases the largest values it sees. One
 * $200k deal among $2k deals will pull spend toward whatever superficially
 * resembled that lead. Capping at 3× median keeps relative ordering intact
 * while removing the distortion.
 */
export function valueSpreadAndCaps(
  deals: MappedDeal[],
  capMultiple: number = DEFAULT_CAP_MULTIPLE
): ValueSpread {
  const amounts = wonWithAmount(deals).map((d) => d.amount!);

  if (amounts.length === 0) {
    return {
      sampleSize: 0,
      min: null, p25: null, median: null, p75: null, max: null,
      blindnessRatio: null,
      recommendedCap: null,
      capMultiple,
      dealsAboveCap: 0,
    };
  }

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const med = quantile(amounts, 0.5)!;
  const cap = round(med * capMultiple);

  return {
    sampleSize: amounts.length,
    min: round(min),
    p25: round(quantile(amounts, 0.25)!),
    median: round(med),
    p75: round(quantile(amounts, 0.75)!),
    max: round(max),
    // Guard against a zero-value deal producing Infinity.
    blindnessRatio: min > 0 ? round(max / min, 1) : null,
    recommendedCap: cap,
    capMultiple,
    dealsAboveCap: amounts.filter((a) => a > cap).length,
  };
}

/** Applies the cap to a single value. Null passes through untouched. */
export function applyCap(value: number | null, cap: number | null): number | null {
  if (value === null) return null;
  if (cap === null) return value;
  return Math.min(value, cap);
}
