import type { CycleLengthStats, HistogramBucket, MappedDeal } from "./types";
import { daysBetween, quantile, round } from "./helpers";

const BUCKETS: Omit<HistogramBucket, "count">[] = [
  { label: "0–7d",   minDays: 0,  maxDays: 7 },
  { label: "8–14d",  minDays: 8,  maxDays: 14 },
  { label: "15–30d", minDays: 15, maxDays: 30 },
  { label: "31–60d", minDays: 31, maxDays: 60 },
  { label: "61–90d", minDays: 61, maxDays: 90 },
  { label: "90d+",   minDays: 91, maxDays: null },
];

/**
 * (a) Create→close distribution for closed-won deals.
 *
 * Only won deals count: lost-deal cycle time says nothing about how quickly
 * revenue becomes knowable, which is the question that decides MEASURED vs
 * PREDICTED mode.
 */
export function cycleLengthStats(deals: MappedDeal[]): CycleLengthStats {
  const durations = deals
    .filter((d) => d.outcome === "won" && d.createdAt && d.closedAt)
    .map((d) => daysBetween(d.createdAt!, d.closedAt!))
    // A close recorded before creation is bad data, not a negative cycle.
    .filter((days) => days >= 0);

  const histogram: HistogramBucket[] = BUCKETS.map((b) => ({
    ...b,
    count: durations.filter((days) => {
      const whole = Math.floor(days);
      return whole >= b.minDays && (b.maxDays === null || whole <= b.maxDays);
    }).length,
  }));

  if (durations.length === 0) {
    return {
      sampleSize: 0,
      medianDays: null,
      p25Days: null,
      p75Days: null,
      histogram,
      classification: null,
    };
  }

  const medianDays = quantile(durations, 0.5)!;

  return {
    sampleSize: durations.length,
    medianDays: round(medianDays, 1),
    p25Days: round(quantile(durations, 0.25)!, 1),
    p75Days: round(quantile(durations, 0.75)!, 1),
    histogram,
    classification: medianDays < 14 ? "FAST" : medianDays <= 60 ? "MEDIUM" : "LONG",
  };
}
