import type { FactorHypothesis } from "./valueModel";

// Domain types for the VBB diagnostic analysis engine.
//
// A MappedDeal is the normalized shape every analysis function consumes. The
// column-mapping step is responsible for producing these from raw CSV rows;
// analysis functions never see raw headers.

export type DealOutcome = "won" | "lost" | "open";

export interface MappedDeal {
  /** Stable row identity, used for duplicate detection and traceability. */
  id: string;
  createdAt: Date | null;
  closedAt: Date | null;
  outcome: DealOutcome;
  /** Reporting-currency amount. Null when absent or unconvertible. */
  amount: number | null;
  stage: string | null;
  source: string | null;
  email: string | null;
  /** gclid / gbraid / wbraid — any Google click identifier. */
  clickId: string | null;
  /** Seconds spent in each stage, when the CRM exports it. */
  stageDurations?: Record<string, number>;
  /** Days from creation to first reaching each stage, when derivable. */
  stageReachedAfterDays?: Record<string, number>;
  /** Optional firmographics, present only in enriched exports. */
  employeeCount?: number | null;
  industry?: string | null;
  contactTitle?: string | null;
  /**
   * Extra categorical columns the user mapped as value signals (budget band,
   * timeline, use case…). Keyed by column name.
   */
  signals?: Record<string, string>;
}

/** A row dropped before analysis, always surfaced to the user. */
export interface ExcludedRow {
  id: string;
  reason: string;
}

export interface AnalysisInput {
  deals: MappedDeal[];
  excluded: ExcludedRow[];
  /** Raw free text from the intake step. Never parsed into structure. */
  businessContext?: string;
  currencyCode: string;
  /** Extra mapped columns to test as value signals. */
  customSignalKeys?: string[];
  /** Claims from the intake step, attached to the factor that can test them. */
  hypotheses?: FactorHypothesis[];
  /** Reference point for "last 6 months" windows. Injected for testability. */
  now?: Date;
}

// ---------------------------------------------------------------------------
// (a) cycleLengthStats
// ---------------------------------------------------------------------------

export type CycleClass = "FAST" | "MEDIUM" | "LONG";

export interface HistogramBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  count: number;
}

export interface CycleLengthStats {
  sampleSize: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  histogram: HistogramBucket[];
  classification: CycleClass | null;
}

// ---------------------------------------------------------------------------
// (b) stageTrustCheck
// ---------------------------------------------------------------------------

export interface StageTrustFinding {
  stage: string;
  sampleSize: number;
  /** Share of durations under one hour, 0-1. */
  subHourRate: number;
  trusted: boolean;
}

export interface StageTrustResult {
  /** False when the export carried no stage-duration data at all. */
  available: boolean;
  findings: StageTrustFinding[];
  untrustedStages: string[];
}

// ---------------------------------------------------------------------------
// (c) earlyGateDetection
// ---------------------------------------------------------------------------

export interface EarlyGateCandidate {
  stage: string;
  reachedCount: number;
  /** Share reaching the stage within 7 days of creation, 0-1. */
  withinWindowRate: number;
}

export interface EarlyGateResult {
  available: boolean;
  candidates: EarlyGateCandidate[];
  /** Best stage that fires reliably inside Google's 7-day window. */
  recommended: EarlyGateCandidate | null;
  /** Present when no reliable gate exists — shown to the user verbatim. */
  message: string | null;
}

// ---------------------------------------------------------------------------
// (d) sourceEconomics
// ---------------------------------------------------------------------------

export interface SourceEconomics {
  source: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  /** won / (won + lost). Null when nothing has closed yet. */
  closeRate: number | null;
  medianWonAmount: number | null;
  avgWonAmount: number | null;
  totalWonValue: number;
}

// ---------------------------------------------------------------------------
// (e) matchRateReadiness
// ---------------------------------------------------------------------------

export interface MatchRateReadiness {
  totalRows: number;
  withClickId: number;
  withValidEmail: number;
  withAnyIdentifier: number;
  overallRate: number;
  wonRows: number;
  wonWithAnyIdentifier: number;
  wonRate: number;
  /** True when coverage is too thin for VBB to function. */
  isTrackingGap: boolean;
}

// ---------------------------------------------------------------------------
// (f) valueSpreadAndCaps
// ---------------------------------------------------------------------------

export interface ValueSpread {
  sampleSize: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  /** max / min. Null when min is 0 or there is no data. */
  blindnessRatio: number | null;
  recommendedCap: number | null;
  capMultiple: number;
  /** How many won deals the cap would clip. */
  dealsAboveCap: number;
}

// ---------------------------------------------------------------------------
// (g) volumeCheck
// ---------------------------------------------------------------------------

export interface VolumeCheck {
  monthsObserved: number;
  leadsPerMonth: number;
  wonDealsPerMonth: number;
  /** Lead volume is what gates Smart Bidding viability, not deal volume. */
  leadVolumeSufficient: boolean;
  warning: string | null;
}

// ---------------------------------------------------------------------------
// (h) domainValueDisparity
// ---------------------------------------------------------------------------

export type DomainType = "corporate" | "free" | "unknown";

export interface SegmentStats {
  segment: string;
  total: number;
  won: number;
  lost: number;
  closeRate: number | null;
  medianWonAmount: number | null;
  /** closeRate × medianWonAmount, uncapped. */
  expectedValue: number | null;
}

export interface DomainValueDisparity {
  available: boolean;
  byDomainType: SegmentStats[];
  byEmployeeBand?: SegmentStats[];
  byIndustry?: SegmentStats[];
}

// ---------------------------------------------------------------------------
// (i) icpFitCheck
// ---------------------------------------------------------------------------

export interface IcpTraits {
  employeeMin: number | null;
  employeeMax: number | null;
  industries: string[];
  titles: string[];
}

export interface IcpFitResult {
  available: boolean;
  traits: IcpTraits | null;
  matching: SegmentStats | null;
  nonMatching: SegmentStats | null;
  /** True when either segment is under 20 deals — phrasing must hedge. */
  lowConfidence: boolean;
  /** Share of won revenue coming from ICP-matching deals, 0-1. */
  wonRevenueShareMatching: number | null;
}

// ---------------------------------------------------------------------------
// (k) verdict
// ---------------------------------------------------------------------------

export type VerdictMode = "MEASURED" | "PREDICTED" | "NOT_YET";

export interface Verdict {
  mode: VerdictMode;
  headline: string;
  reasoning: string;
  /** Concrete things to fix, populated for NOT_YET. */
  blockers: string[];
}

// ---------------------------------------------------------------------------
// Shadow ROAS (report section 1)
// ---------------------------------------------------------------------------

export interface ShadowRoasRow {
  source: string;
  leads: number;
  /** What Google currently optimizes toward: every lead counts as 1. */
  googleSeesValue: number;
  wonDeals: number;
  actualValue: number;
  /** actualValue per lead — the number Google should be bidding on. */
  actualValuePerLead: number;
}

// ---------------------------------------------------------------------------
// Full result
// ---------------------------------------------------------------------------

import type { ValueModel } from "./valueModel";

export interface DiagnosticResult {
  rowsAnalyzed: number;
  excluded: ExcludedRow[];
  currencyCode: string;
  businessContext?: string;
  shadowRoas: ShadowRoasRow[];
  cycle: CycleLengthStats;
  stageTrust: StageTrustResult;
  earlyGate: EarlyGateResult;
  sources: SourceEconomics[];
  matchRate: MatchRateReadiness;
  valueSpread: ValueSpread;
  volume: VolumeCheck;
  domainDisparity: DomainValueDisparity;
  icpFit: IcpFitResult;
  /** The Day-0 value model. Built only on lead-intrinsic attributes. */
  valueModel: ValueModel;
  verdict: Verdict;
}
