import type {
  CycleLengthStats,
  EarlyGateResult,
  MatchRateReadiness,
  Verdict,
  VolumeCheck,
} from "./types";

/**
 * (k) The operating mode this account can support today.
 *
 * Ordering matters. Volume and identifier coverage are hard gates — no amount
 * of clever value modelling rescues an account that can't join leads to clicks
 * or doesn't have enough of them. Cycle length then decides whether real
 * outcomes arrive fast enough to send directly (MEASURED) or whether Day-0
 * cohort values must stand in (PREDICTED).
 */
export function determineVerdict(
  cycle: CycleLengthStats,
  volume: VolumeCheck,
  matchRate: MatchRateReadiness,
  earlyGate: EarlyGateResult
): Verdict {
  const blockers: string[] = [];

  if (!volume.leadVolumeSufficient) {
    blockers.push(
      `Lead volume is ${volume.leadsPerMonth}/month. Smart Bidding needs roughly 30+ to learn from value signals.`
    );
  }
  if (matchRate.isTrackingGap) {
    blockers.push(
      `Only ${Math.round(matchRate.overallRate * 100)}% of leads carry a click ID or usable email. Without an identifier there is nothing to send values against.`
    );
  }
  if (cycle.sampleSize === 0) {
    blockers.push(
      "No closed-won deals with both a create and close date, so there is no history to price leads from."
    );
  }

  if (blockers.length > 0) {
    return {
      mode: "NOT_YET",
      headline: "Fix these before switching on value-based bidding.",
      reasoning:
        "Value-based bidding would produce unreliable results on this data. Each item below is fixable, and the diagnostic re-runs as soon as it is.",
      blockers,
    };
  }

  if (cycle.classification === "FAST") {
    return {
      mode: "MEASURED",
      headline: "Your account can send real conversion values today.",
      reasoning:
        `Half your won deals close within ${cycle.medianDays} days of creation, fast enough to report actual revenue back to Google while it still influences bidding. You don't need predicted values — you have real ones.`,
      blockers: [],
    };
  }

  const gateNote = earlyGate.recommended
    ? ` Your "${earlyGate.recommended.stage}" stage fires within 7 days for ${Math.round(earlyGate.recommended.withinWindowRate * 100)}% of deals, so it can sharpen those Day-0 values while the adjustment window is still open.`
    : " No stage in your data fires reliably inside the 7-day window, so Day-0 cohort values stand on their own and get recalibrated nightly as deals close.";

  return {
    mode: "PREDICTED",
    headline: "Send predicted values at lead creation, not actual ones.",
    reasoning:
      `Your median deal takes ${cycle.medianDays} days to close — well past the 7-day window in which Google still acts on a value adjustment. Waiting for the real number means bidding on stale signals, so leads are priced at creation using what similar leads have historically been worth.${gateNote}`,
    blockers: [],
  };
}
