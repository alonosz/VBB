import type { AnalysisInput, DiagnosticResult } from "./types";
import { cycleLengthStats } from "./cycleLength";
import { stageTrustCheck } from "./stageTrust";
import { earlyGateDetection } from "./earlyGate";
import { shadowRoas, sourceEconomics } from "./sourceEconomics";
import { matchRateReadiness } from "./matchRate";
import { valueSpreadAndCaps, DEFAULT_CAP_MULTIPLE } from "./valueSpread";
import { volumeCheck } from "./volume";
import { domainValueDisparity, icpFitCheck } from "./segments";
import { buildValueModel } from "./valueModel";
import { determineVerdict } from "./verdict";
import { gateValue } from "./gateValue";

export * from "./types";
export { cycleLengthStats } from "./cycleLength";
export { stageTrustCheck } from "./stageTrust";
export { earlyGateDetection, ADJUSTMENT_WINDOW_DAYS } from "./earlyGate";
export { sourceEconomics, shadowRoas } from "./sourceEconomics";
export { matchRateReadiness, TRACKING_GAP_THRESHOLD } from "./matchRate";
export { valueSpreadAndCaps, applyCap, DEFAULT_CAP_MULTIPLE } from "./valueSpread";
export { volumeCheck } from "./volume";
export { domainValueDisparity, icpFitCheck, extractIcpTraits } from "./segments";
export * from "./valueModel";
export * from "./factors";
export { determineVerdict } from "./verdict";
export * from "./gateValue";

/**
 * Runs the full diagnostic. Every function here is pure, so the same input
 * always yields the same report - which is what lets us show a user the rule
 * behind any number on screen.
 */
export function runDiagnostic(input: AnalysisInput): DiagnosticResult {
  const { deals, excluded, businessContext, currencyCode, customSignalKeys, hypotheses } = input;
  const audience = input.audience ?? "b2b";
  const now = input.now ?? new Date();

  const cycle = cycleLengthStats(deals);
  const stageTrust = stageTrustCheck(deals);
  const earlyGate = earlyGateDetection(deals, stageTrust.untrustedStages);
  const sources = sourceEconomics(deals);
  const matchRate = matchRateReadiness(deals);
  const valueSpread = valueSpreadAndCaps(deals, DEFAULT_CAP_MULTIPLE);
  const volume = volumeCheck(deals, now);
  const domainDisparity = domainValueDisparity(deals);
  const icpFit = icpFitCheck(deals, businessContext);
  const valueModel = buildValueModel({
    deals,
    cap: valueSpread.recommendedCap,
    currencyCode,
    customSignalKeys,
    hypotheses,
    audience,
  });
  const verdict = determineVerdict(cycle, volume, matchRate, earlyGate);
  // What reaching the early gate is worth - the one signal that can sharpen a
  // lead's value after it arrived, and only inside Google's window.
  const gate = gateValue(deals, earlyGate);

  return {
    rowsAnalyzed: deals.length,
    excluded,
    currencyCode,
    businessContext,
    shadowRoas: shadowRoas(deals),
    cycle,
    stageTrust,
    earlyGate,
    gate,
    sources,
    matchRate,
    valueSpread,
    volume,
    domainDisparity,
    icpFit,
    valueModel,
    verdict,
  };
}
