import type { EarlyGateCandidate, EarlyGateResult, MappedDeal } from "./types";
import { round } from "./helpers";

/** Google ignores value adjustments sent after this many days. */
export const ADJUSTMENT_WINDOW_DAYS = 7;

const MIN_SAMPLE = 20;
const MIN_WITHIN_WINDOW_RATE = 0.6;

/**
 * (c) Finds a stage that reliably fires inside Google's 7-day adjustment
 * window, usable as an early proxy for eventual value.
 *
 * Stages flagged as backfilled by stageTrustCheck are excluded outright — a
 * gate built on fabricated timestamps would emit adjustments on a schedule
 * that never happened.
 */
export function earlyGateDetection(
  deals: MappedDeal[],
  untrustedStages: string[] = []
): EarlyGateResult {
  const untrusted = new Set(untrustedStages);
  const reachedByStage = new Map<string, number[]>();

  for (const deal of deals) {
    if (!deal.stageReachedAfterDays) continue;
    for (const [stage, days] of Object.entries(deal.stageReachedAfterDays)) {
      if (untrusted.has(stage)) continue;
      if (!Number.isFinite(days) || days < 0) continue;
      const bucket = reachedByStage.get(stage);
      if (bucket) bucket.push(days);
      else reachedByStage.set(stage, [days]);
    }
  }

  if (reachedByStage.size === 0) {
    return {
      available: false,
      candidates: [],
      recommended: null,
      message: untrusted.size > 0
        ? "No reliable early gate found — the stages we could measure all showed backfilled timestamps."
        : "No reliable early gate found — this export has no stage-timing data to measure.",
    };
  }

  const candidates: EarlyGateCandidate[] = [];
  for (const [stage, allDays] of reachedByStage) {
    const withinWindow = allDays.filter((d) => d <= ADJUSTMENT_WINDOW_DAYS).length;
    candidates.push({
      stage,
      reachedCount: allDays.length,
      withinWindowRate: round(withinWindow / allDays.length, 3),
    });
  }

  candidates.sort((a, b) => b.withinWindowRate - a.withinWindowRate);

  const recommended = candidates.find(
    (c) => c.reachedCount >= MIN_SAMPLE && c.withinWindowRate >= MIN_WITHIN_WINDOW_RATE
  ) ?? null;

  return {
    available: true,
    candidates,
    recommended,
    message: recommended
      ? null
      : "No reliable early gate found — no stage fires inside the 7-day window often enough to bid on.",
  };
}
