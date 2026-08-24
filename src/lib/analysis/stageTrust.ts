import type { MappedDeal, StageTrustFinding, StageTrustResult } from "./types";
import { round } from "./helpers";

const ONE_HOUR_SECONDS = 3600;
const SUB_HOUR_THRESHOLD = 0.3;

/**
 * (b) Flags stages whose durations look retroactively backfilled.
 *
 * Real accounts are full of 9-second stage transitions produced by someone
 * dragging a card through three stages at once after the fact. Those
 * timestamps describe CRM hygiene, not the sales process, so any stage where
 * more than 30% of durations fall under an hour is marked untrusted and
 * excluded from early-gate detection.
 */
export function stageTrustCheck(deals: MappedDeal[]): StageTrustResult {
  const durationsByStage = new Map<string, number[]>();

  for (const deal of deals) {
    if (!deal.stageDurations) continue;
    for (const [stage, seconds] of Object.entries(deal.stageDurations)) {
      if (!Number.isFinite(seconds) || seconds < 0) continue;
      const bucket = durationsByStage.get(stage);
      if (bucket) bucket.push(seconds);
      else durationsByStage.set(stage, [seconds]);
    }
  }

  if (durationsByStage.size === 0) {
    return { available: false, findings: [], untrustedStages: [] };
  }

  const findings: StageTrustFinding[] = [];
  for (const [stage, durations] of durationsByStage) {
    const subHour = durations.filter((s) => s < ONE_HOUR_SECONDS).length;
    const subHourRate = subHour / durations.length;
    findings.push({
      stage,
      sampleSize: durations.length,
      subHourRate: round(subHourRate, 3),
      trusted: subHourRate <= SUB_HOUR_THRESHOLD,
    });
  }

  findings.sort((a, b) => b.subHourRate - a.subHourRate);

  return {
    available: true,
    findings,
    untrustedStages: findings.filter((f) => !f.trusted).map((f) => f.stage),
  };
}
