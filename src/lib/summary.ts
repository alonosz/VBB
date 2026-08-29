import type { ModelConfig, RuleBlock } from "./types";
import { RULE_TYPE_META } from "./blockDefaults";

export interface SummaryLine {
  block: RuleBlock;
  pct: number;
}

export function buildSummaryLines(model: ModelConfig): SummaryLine[] {
  const active = model.blocks.filter((b) => b.enabled);
  const total = active.reduce((s, b) => s + b.weight, 0);
  if (total <= 0) return active.map((block) => ({ block, pct: 0 }));

  return active
    .map((block) => ({ block, pct: Math.round((block.weight / total) * 100) }))
    .sort((a, b) => b.pct - a.pct);
}

export function ruleDescription(block: RuleBlock): string {
  const rule = block.rule;
  switch (rule.type) {
    case "value_tier":
      return `values of "${rule.column || "-"}"`;
    case "numeric_bucket":
      return rule.mode === "percentile"
        ? `where "${rule.column || "-"}" ranks against other records`
        : `the range "${rule.column || "-"}" falls into`;
    case "boolean_flag":
      return `whether "${rule.column || "-"}" is filled in`;
    case "time_decay":
      return `time between "${rule.startColumn || "-"}" and "${rule.endColumn || "-"}"`;
  }
}

export function composeSummarySentence(model: ModelConfig): string {
  const lines = buildSummaryLines(model);
  if (lines.length === 0) return "This model has no active scoring rules yet.";

  const parts = lines.map((l) => `${l.pct}% ${ruleDescription(l.block)}`);
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  return `Records are scored based on: ${joined}.`;
}

export { RULE_TYPE_META };
