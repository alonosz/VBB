// Core domain types for the value-based bidding model builder.

export interface CsvData {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

export type MatchType = "email" | "gclid";

export interface MatchConfig {
  column: string | null;
  type: MatchType;
}

export type RuleType =
  | "value_tier"
  | "numeric_bucket"
  | "boolean_flag"
  | "time_decay";

export interface ValueTierRow {
  value: string;
  points: number;
}

export interface ValueTierRule {
  type: "value_tier";
  column: string;
  tiers: ValueTierRow[];
  defaultPoints: number;
}

export interface NumericBucket {
  min: number | null; // null = unbounded (open on the low end)
  max: number | null; // null = unbounded (open on the high end)
  points: number;
}

export interface NumericBucketRule {
  type: "numeric_bucket";
  column: string;
  mode: "range" | "percentile";
  buckets: NumericBucket[]; // used when mode === "range"
  percentileBucketCount: number; // used when mode === "percentile"
  percentileScores: number[]; // length === percentileBucketCount, low -> high
}

export interface BooleanFlagRule {
  type: "boolean_flag";
  column: string;
  presentPoints: number;
  absentPoints: number;
}

export interface TimeDecayRule {
  type: "time_decay";
  startColumn: string;
  endColumn: string;
  maxPoints: number;
  halfLifeDays: number;
}

export type RuleDetail =
  | ValueTierRule
  | NumericBucketRule
  | BooleanFlagRule
  | TimeDecayRule;

export interface RuleBlock {
  id: string;
  label: string;
  weight: number; // 0-100
  enabled: boolean;
  rule: RuleDetail;
}

export const MODEL_FORMAT_VERSION = 1;

export interface ModelConfig {
  formatVersion: typeof MODEL_FORMAT_VERSION;
  name: string;
  createdAt: string;
  blocks: RuleBlock[];
}

export interface ScoredRow {
  row: Record<string, string>;
  score: number; // 0-100
  tier: "High" | "Medium" | "Low";
  excluded: boolean;
  exclusionReason?: string;
}

export interface ExportConfig {
  conversionName: string;
  conversionTimeColumn: string | null;
  currencyCode: string;
  maxConversionValue: number; // score 100 maps to this value
}
