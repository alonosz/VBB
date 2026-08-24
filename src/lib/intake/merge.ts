import type { DetectedField, FieldKey } from "@/lib/mapping/detect";
import type { IntakeProposal } from "./proposal";

/**
 * Merging the proposal into the detected mapping.
 *
 * The header heuristics are evidence about the file; the assistant's proposal
 * is evidence about what the advertiser meant. Where the heuristics are
 * confident they win — they read the actual values. Where they found nothing
 * or were unsure, the proposal fills the gap. Where the two disagree, the
 * disagreement is shown rather than resolved silently, because the person
 * looking at the screen is the only one who knows their CRM.
 */

/** Above this, the heuristics measured enough to stand on their own. */
export const HEURISTIC_TRUST_FLOOR = 0.8;

export interface MergeResult {
  fields: DetectedField[];
  /** Fields the proposal filled in or changed. */
  applied: FieldKey[];
  /** Fields where the two disagreed and the heuristic was kept. */
  disagreed: FieldKey[];
}

export function applyProposal(
  fields: DetectedField[],
  proposal: IntakeProposal
): MergeResult {
  const suggestionFor = new Map(proposal.columnMapping.map((s) => [s.field, s]));
  const applied: FieldKey[] = [];
  const disagreed: FieldKey[] = [];

  // A mapping the heuristics are confident about, or the user set by hand,
  // holds its column against the proposal.
  const locked = new Map<string, DetectedField>();
  for (const f of fields) {
    if (!f.column) continue;
    const strong = f.source === "user" || (f.confidence ?? 0) >= HEURISTIC_TRUST_FLOOR;
    if (strong) locked.set(f.column, f);
  }

  const next = fields.map((field) => ({ ...field }));
  const byKey = new Map(next.map((f) => [f.key, f]));

  for (const [key, suggestion] of suggestionFor) {
    const field = byKey.get(key);
    if (!field) continue;
    if (field.column === suggestion.column) {
      // Agreement is worth saying out loud — it is the cheapest confidence
      // the user can get that the mapping is right.
      field.reason = `${field.reason ?? "Matched by column name"} · your description agrees`;
      continue;
    }

    const holder = locked.get(suggestion.column);
    if (holder && holder.key !== key) {
      field.disagreement = `Your description points at "${suggestion.column}", but we read that column as ${holder.label}.`;
      disagreed.push(key);
      continue;
    }

    if (field.column && field.source !== "assistant" && (field.confidence ?? 0) >= HEURISTIC_TRUST_FLOOR) {
      field.disagreement = `Your description suggests "${suggestion.column}" instead. We kept "${field.column}" because its values match — change it if we got it wrong.`;
      disagreed.push(key);
      continue;
    }

    // Free the column from whichever weakly-matched field held it.
    for (const other of next) {
      if (other.key !== key && other.column === suggestion.column) {
        other.column = null;
        other.confidence = null;
        other.reason = `Your description uses this column for ${field.label} instead`;
        other.source = "assistant";
      }
    }

    field.column = suggestion.column;
    // No percentage: this is a suggestion read from a description, not a
    // measurement of the column's values.
    field.confidence = null;
    field.reason = suggestion.why;
    field.source = "assistant";
    locked.set(suggestion.column, field);
    applied.push(key);
  }

  return { fields: next, applied, disagreed };
}

// ---------------------------------------------------------------------------
// Candidate factors → things the engine can actually test
// ---------------------------------------------------------------------------

export interface Hypothesis {
  /** The factor key the engine will fit, core or custom. */
  factorKey: string;
  /** The column that carries it. */
  column: string;
  /** The advertiser's claim, in their words. */
  claim: string;
  statedLevels: string[];
}

export interface ResolvedHypotheses {
  hypotheses: Hypothesis[];
  /** Columns to carry onto each deal as extra categorical signals. */
  customSignalKeys: string[];
}

/**
 * A claim about job titles is a claim about the seniority factor we already
 * fit — it should sharpen the report, not add a duplicate rule. Only a claim
 * about a column we have no factor for becomes a new custom signal.
 */
const CORE_FACTOR_FOR_FIELD: Partial<Record<FieldKey, string>> = {
  email: "domainType",
  employeeCount: "employeeBand",
  industry: "industry",
  contactTitle: "seniority",
};

export function resolveHypotheses(
  proposal: IntakeProposal,
  fields: DetectedField[]
): ResolvedHypotheses {
  const fieldForColumn = new Map<string, FieldKey>();
  for (const f of fields) {
    if (f.column) fieldForColumn.set(f.column, f.key);
  }

  const hypotheses: Hypothesis[] = [];
  const customSignalKeys: string[] = [];

  for (const candidate of proposal.candidateFactors) {
    const fieldKey = fieldForColumn.get(candidate.column);

    // Source is never a value factor — the ad platform already knows the
    // channel, and CRM attribution is overwritten by later touches.
    if (fieldKey === "source") continue;

    const coreKey = fieldKey ? CORE_FACTOR_FOR_FIELD[fieldKey] : undefined;
    const factorKey = coreKey ?? candidate.column;

    // A column already mapped to something structural (amount, dates, stage)
    // is not a lead-intrinsic categorical signal.
    if (!coreKey && fieldKey) continue;
    if (hypotheses.some((h) => h.factorKey === factorKey)) continue;

    if (!coreKey) customSignalKeys.push(candidate.column);
    hypotheses.push({
      factorKey,
      column: candidate.column,
      claim: candidate.userClaim,
      statedLevels: candidate.statedLevels,
    });
  }

  return { hypotheses, customSignalKeys };
}
