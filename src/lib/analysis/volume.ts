import type { MappedDeal, VolumeCheck } from "./types";
import { monthsSpanned, round } from "./helpers";

export const MIN_LEADS_PER_MONTH = 30;
const LOOKBACK_DAYS = 182;

/**
 * (g) Lead volume and won-deal volume, reported separately.
 *
 * These answer different questions and conflating them is a common mistake.
 * Once Day-0 scoring exists, Smart Bidding viability depends on *lead* volume
 * - a business closing 4 deals a month off 300 leads is perfectly viable.
 * Low deal volume alone is therefore not disqualifying.
 */
export function volumeCheck(deals: MappedDeal[], now: Date = new Date()): VolumeCheck {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const recent = deals.filter((d) => d.createdAt && d.createdAt >= cutoff);
  const dates = recent.map((d) => d.createdAt!).filter(Boolean);
  const months = monthsSpanned(dates);

  const wonRecent = deals.filter(
    (d) => d.outcome === "won" && d.closedAt && d.closedAt >= cutoff
  );

  const leadsPerMonth = months > 0 ? recent.length / months : 0;
  const wonPerMonth = months > 0 ? wonRecent.length / months : 0;
  const sufficient = leadsPerMonth >= MIN_LEADS_PER_MONTH;

  return {
    monthsObserved: round(months, 1),
    leadsPerMonth: round(leadsPerMonth, 1),
    wonDealsPerMonth: round(wonPerMonth, 1),
    leadVolumeSufficient: sufficient,
    warning: sufficient
      ? null
      : `Only ${round(leadsPerMonth, 1)} leads per month. Smart Bidding needs roughly ${MIN_LEADS_PER_MONTH}+ to learn from value signals - below that, bidding stays noisy no matter how good the values are.`,
  };
}
