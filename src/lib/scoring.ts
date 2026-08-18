import type {
  ModelConfig,
  RuleBlock,
  ScoredRow,
  NumericBucketRule,
} from "./types";

export const TIER_THRESHOLDS = { high: 70, medium: 40 };

export function clampPoints(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(-100, Math.min(100, n));
}

export function parseNumeric(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseDateValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const t = Date.parse(trimmed);
  return Number.isNaN(t) ? null : t;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computePercentileEdges(
  values: number[],
  bucketCount: number
): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < bucketCount; i++) {
    edges.push(quantile(sorted, i / bucketCount));
  }
  return edges;
}

// Cache of derived per-column stats needed for percentile-mode buckets.
export interface DatasetStats {
  percentileEdges: Record<string, number[]>; // keyed by blockId
}

export function computeDatasetStats(
  rows: Record<string, string>[],
  blocks: RuleBlock[]
): DatasetStats {
  const percentileEdges: Record<string, number[]> = {};
  for (const block of blocks) {
    if (block.rule.type !== "numeric_bucket") continue;
    const rule = block.rule as NumericBucketRule;
    if (rule.mode !== "percentile") continue;
    const values = rows
      .map((r) => parseNumeric(r[rule.column]))
      .filter((v): v is number => v !== null);
    percentileEdges[block.id] = computePercentileEdges(
      values,
      Math.max(2, rule.percentileScores.length)
    );
  }
  return { percentileEdges };
}

export interface BlockScoreResult {
  points: number;
  applicable: boolean;
}

export function scoreBlock(
  row: Record<string, string>,
  block: RuleBlock,
  stats: DatasetStats
): BlockScoreResult {
  const rule = block.rule;

  if (rule.type === "value_tier") {
    const raw = (row[rule.column] ?? "").toString().trim();
    if (!raw) return { points: rule.defaultPoints, applicable: false };
    const match = rule.tiers.find(
      (t) => t.value.trim().toLowerCase() === raw.toLowerCase()
    );
    return {
      points: clampPoints(match ? match.points : rule.defaultPoints),
      applicable: true,
    };
  }

  if (rule.type === "boolean_flag") {
    const raw = (row[rule.column] ?? "").toString().trim();
    const present = raw !== "" && !/^(false|no|0|n)$/i.test(raw);
    return {
      points: clampPoints(present ? rule.presentPoints : rule.absentPoints),
      applicable: true,
    };
  }

  if (rule.type === "numeric_bucket") {
    const val = parseNumeric(row[rule.column]);
    if (val === null) return { points: 0, applicable: false };

    if (rule.mode === "range") {
      const bucket = rule.buckets.find((b) => {
        const min = b.min ?? -Infinity;
        const max = b.max ?? Infinity;
        return val >= min && val <= max;
      });
      return { points: clampPoints(bucket ? bucket.points : 0), applicable: true };
    }

    // percentile mode
    const edges = stats.percentileEdges[block.id] ?? [];
    let idx = edges.findIndex((edge) => val <= edge);
    if (idx === -1) idx = rule.percentileScores.length - 1;
    const points = rule.percentileScores[idx] ?? 0;
    return { points: clampPoints(points), applicable: true };
  }

  // time_decay
  const start = parseDateValue(row[rule.startColumn]);
  const end = parseDateValue(row[rule.endColumn]);
  if (start === null || end === null) return { points: 0, applicable: false };
  const days = Math.max(0, (end - start) / 86400000);
  const halfLife = Math.max(0.01, rule.halfLifeDays);
  const points = rule.maxPoints * Math.pow(0.5, days / halfLife);
  return { points: clampPoints(points), applicable: true };
}

export interface RowScoreBreakdown {
  blockId: string;
  points: number;
  applicable: boolean;
  weight: number;
}

export function scoreRow(
  row: Record<string, string>,
  model: ModelConfig,
  stats: DatasetStats
): { score: number; breakdown: RowScoreBreakdown[] } {
  const activeBlocks = model.blocks.filter((b) => b.enabled);
  const totalWeight = activeBlocks.reduce((sum, b) => sum + b.weight, 0);

  const breakdown: RowScoreBreakdown[] = activeBlocks.map((block) => {
    const { points, applicable } = scoreBlock(row, block, stats);
    return { blockId: block.id, points, applicable, weight: block.weight };
  });

  if (totalWeight <= 0) return { score: 0, breakdown };

  const weighted = breakdown.reduce(
    (sum, b) => sum + b.points * b.weight,
    0
  );
  const blended = weighted / totalWeight;
  const score = Math.round(Math.max(0, Math.min(100, blended)));
  return { score, breakdown };
}

export function scoreToTier(score: number): "High" | "Medium" | "Low" {
  if (score >= TIER_THRESHOLDS.high) return "High";
  if (score >= TIER_THRESHOLDS.medium) return "Medium";
  return "Low";
}

export interface HistogramBin {
  range: string;
  count: number;
}

export function computeHistogram(scored: ScoredRow[]): HistogramBin[] {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${i * 10 + 9}`,
    count: 0,
  }));
  for (const s of scored) {
    if (s.excluded) continue;
    const idx = Math.min(9, Math.floor(s.score / 10));
    bins[idx].count += 1;
  }
  return bins;
}

export function computeModelScores(
  rows: Record<string, string>[],
  model: ModelConfig,
  matchColumn: string | null
): ScoredRow[] {
  const stats = computeDatasetStats(rows, model.blocks);

  return rows.map((row) => {
    const { score } = scoreRow(row, model, stats);
    const tier = scoreToTier(score);

    if (matchColumn) {
      const matchVal = (row[matchColumn] ?? "").toString().trim();
      if (!matchVal) {
        return {
          row,
          score,
          tier,
          excluded: true,
          exclusionReason: `Missing value in match field "${matchColumn}"`,
        };
      }
    }
    return { row, score, tier, excluded: false };
  });
}
