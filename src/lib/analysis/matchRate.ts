import type { MappedDeal, MatchRateReadiness } from "./types";
import { hasIdentifier, isValidEmail, round } from "./helpers";

/** Below this, VBB cannot meaningfully function and we say so loudly. */
export const TRACKING_GAP_THRESHOLD = 0.4;

/**
 * (e) Share of rows carrying something we can join back to an ad click.
 *
 * Reported overall and for won deals separately - won-deal coverage is the
 * one that actually matters, since those carry the values worth sending.
 */
export function matchRateReadiness(deals: MappedDeal[]): MatchRateReadiness {
  const total = deals.length;
  const withClickId = deals.filter((d) => !!d.clickId?.trim()).length;
  const withValidEmail = deals.filter((d) => isValidEmail(d.email)).length;
  const withAny = deals.filter(hasIdentifier).length;

  const won = deals.filter((d) => d.outcome === "won");
  const wonWithAny = won.filter(hasIdentifier).length;

  const overallRate = total > 0 ? withAny / total : 0;
  const wonRate = won.length > 0 ? wonWithAny / won.length : 0;

  return {
    totalRows: total,
    withClickId,
    withValidEmail,
    withAnyIdentifier: withAny,
    overallRate: round(overallRate, 4),
    wonRows: won.length,
    wonWithAnyIdentifier: wonWithAny,
    wonRate: round(wonRate, 4),
    isTrackingGap: total > 0 && overallRate < TRACKING_GAP_THRESHOLD,
  };
}
