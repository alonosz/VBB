import type { RuleBlock, RuleType } from "./types";
import { parseDateValue, parseNumeric } from "./scoring";

function guessColumnByValue(
  headers: string[],
  sampleRows: Record<string, string>[],
  test: (raw: string) => boolean
): string | null {
  for (const h of headers) {
    const values = sampleRows.map((r) => (r[h] ?? "").toString().trim()).filter(Boolean);
    if (values.length === 0) continue;
    const matches = values.filter(test).length;
    if (matches / values.length >= 0.7) return h;
  }
  return null;
}

export function newBlockId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `blk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const RULE_TYPE_META: Record<
  RuleType,
  { label: string; icon: string; description: string }
> = {
  value_tier: {
    label: "Value tier",
    icon: "🏷️",
    description: "Map specific column values to points (e.g. Won → 100)",
  },
  numeric_bucket: {
    label: "Numeric bucket",
    icon: "📊",
    description: "Score a number field by range or percentile",
  },
  boolean_flag: {
    label: "Boolean flag",
    icon: "☑️",
    description: "Add or subtract points based on presence of a value",
  },
  time_decay: {
    label: "Time decay",
    icon: "⏱️",
    description: "Score decreases the longer between two dates",
  },
};

export function createDefaultBlock(
  type: RuleType,
  headers: string[],
  sampleRows: Record<string, string>[] = []
): RuleBlock {
  const id = newBlockId();
  const col0 = headers[0] ?? "";

  const numericCol =
    guessColumnByValue(headers, sampleRows, (v) => parseNumeric(v) !== null) ?? col0;
  const dateCol =
    guessColumnByValue(headers, sampleRows, (v) => parseDateValue(v) !== null) ?? col0;
  const dateCols = headers.filter(
    (h) =>
      guessColumnByValue([h], sampleRows, (v) => parseDateValue(v) !== null) !== null
  );
  const dateCol2 = dateCols[1] ?? dateCol;

  switch (type) {
    case "value_tier":
      return {
        id,
        label: "Value tier",
        weight: 0,
        enabled: true,
        rule: {
          type: "value_tier",
          column: col0,
          tiers: [
            { value: "", points: 100 },
            { value: "", points: 50 },
          ],
          defaultPoints: 0,
        },
      };
    case "numeric_bucket":
      return {
        id,
        label: "Numeric bucket",
        weight: 0,
        enabled: true,
        rule: {
          type: "numeric_bucket",
          column: numericCol,
          mode: "range",
          buckets: [
            { min: null, max: null, points: 50 },
          ],
          percentileBucketCount: 4,
          percentileScores: [25, 50, 75, 100],
        },
      };
    case "boolean_flag":
      return {
        id,
        label: "Boolean flag",
        weight: 0,
        enabled: true,
        rule: {
          type: "boolean_flag",
          column: col0,
          presentPoints: 100,
          absentPoints: 0,
        },
      };
    case "time_decay":
      return {
        id,
        label: "Time decay",
        weight: 0,
        enabled: true,
        rule: {
          type: "time_decay",
          startColumn: dateCol,
          endColumn: dateCol2,
          maxPoints: 100,
          halfLifeDays: 7,
        },
      };
  }
}

export function percentileLabels(count: number): string[] {
  if (count <= 1) return ["All values"];
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const lower = Math.round((i * 100) / count);
    const upper = Math.round(((i + 1) * 100) / count);
    if (i === 0) labels.push(`Bottom ${upper}%`);
    else if (i === count - 1) labels.push(`Top ${100 - lower}%`);
    else labels.push(`${lower}–${upper}%`);
  }
  return labels;
}
