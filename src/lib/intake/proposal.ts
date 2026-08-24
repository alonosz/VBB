import type { FieldKey } from "@/lib/mapping/detect";

/**
 * The intake proposal: what the assistant suggests, before anything is
 * believed.
 *
 * The assistant is allowed to propose *which column is which* and *what the
 * user claimed about their buyers*. It is never allowed to produce a value, a
 * multiplier, a close rate or a score — those come from the deterministic
 * engine reading the user's own rows. Everything on this type is a hypothesis
 * the engine will test and the user can overrule.
 */

export const FIELD_KEYS = [
  "createdAt",
  "closedAt",
  "outcome",
  "amount",
  "currency",
  "stage",
  "source",
  "email",
  "clickId",
  "pipeline",
  "employeeCount",
  "industry",
  "contactTitle",
] as const satisfies readonly FieldKey[];

export interface MappingSuggestion {
  field: FieldKey;
  column: string;
  /** One short sentence, shown beside the field on the mapping screen. */
  why: string;
}

export interface CandidateFactor {
  /** A column in the uploaded file the user's description implies matters. */
  column: string;
  /** The levels the user said were good, in their words. */
  statedLevels: string[];
  /** The claim itself, quoted back so the report can answer it directly. */
  userClaim: string;
}

export interface IntakeProposal {
  columnMapping: MappingSuggestion[];
  candidateFactors: CandidateFactor[];
  statedCycleDaysMin: number | null;
  statedCycleDaysMax: number | null;
  /** The user's own phrasing, e.g. "2–3 months". */
  statedCycleLabel: string | null;
  statedLeadsPerMonthMin: number | null;
  statedLeadsPerMonthMax: number | null;
  statedSources: string[];
}

export const EMPTY_PROPOSAL: IntakeProposal = {
  columnMapping: [],
  candidateFactors: [],
  statedCycleDaysMin: null,
  statedCycleDaysMax: null,
  statedCycleLabel: null,
  statedLeadsPerMonthMin: null,
  statedLeadsPerMonthMax: null,
  statedSources: [],
};

export type IntakeStatus = "skipped" | "pending" | "ready" | "unavailable";

export interface IntakeOutcome {
  status: IntakeStatus;
  proposal: IntakeProposal;
  /** Plain-English reason, shown to the user when the call did not run. */
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Sanitizing — the trust boundary
// ---------------------------------------------------------------------------

const MAX_FACTORS = 6;
const MAX_LEVELS = 12;
const MAX_TEXT = 240;
const MAX_CYCLE_DAYS = 3650;
const MAX_LEADS_PER_MONTH = 1_000_000;

function text(v: unknown, limit = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed.slice(0, limit);
}

function positive(v: unknown, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(Math.min(v, max) * 10) / 10;
}

/**
 * Turns whatever came back into something the rest of the app can trust.
 *
 * Model output is untrusted input. A column that isn't in the file, a field
 * key we don't have, the same column claimed twice, a made-up number — each
 * gets dropped here rather than defended against in ten places downstream.
 */
export function sanitizeProposal(
  raw: unknown,
  headers: string[]
): IntakeProposal {
  if (!raw || typeof raw !== "object") return EMPTY_PROPOSAL;
  const r = raw as Record<string, unknown>;

  const known = new Set(headers);
  const validKeys = new Set<string>(FIELD_KEYS);

  const columnMapping: MappingSuggestion[] = [];
  const claimedColumns = new Set<string>();
  const claimedFields = new Set<string>();

  if (Array.isArray(r.columnMapping)) {
    for (const entry of r.columnMapping) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const field = typeof e.field === "string" ? e.field : null;
      const column = typeof e.column === "string" ? e.column.trim() : null;
      if (!field || !column) continue;
      // A hallucinated column name is the failure mode that matters most —
      // it would silently map a field to nothing.
      if (!validKeys.has(field) || !known.has(column)) continue;
      if (claimedFields.has(field) || claimedColumns.has(column)) continue;
      claimedFields.add(field);
      claimedColumns.add(column);
      columnMapping.push({
        field: field as FieldKey,
        column,
        why: text(e.why, 160) ?? "Matched from your description",
      });
    }
  }

  const candidateFactors: CandidateFactor[] = [];
  const seenFactorColumns = new Set<string>();
  if (Array.isArray(r.candidateFactors)) {
    for (const entry of r.candidateFactors) {
      if (candidateFactors.length >= MAX_FACTORS) break;
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const column = typeof e.column === "string" ? e.column.trim() : null;
      if (!column || !known.has(column) || seenFactorColumns.has(column)) continue;
      const claim = text(e.userClaim);
      if (!claim) continue;
      seenFactorColumns.add(column);
      candidateFactors.push({
        column,
        statedLevels: Array.isArray(e.statedLevels)
          ? e.statedLevels
              .map((l) => text(l, 60))
              .filter((l): l is string => l !== null)
              .slice(0, MAX_LEVELS)
          : [],
        userClaim: claim,
      });
    }
  }

  let cycleMin = positive(r.statedCycleDaysMin, MAX_CYCLE_DAYS);
  let cycleMax = positive(r.statedCycleDaysMax, MAX_CYCLE_DAYS);
  if (cycleMin !== null && cycleMax !== null && cycleMax < cycleMin) {
    [cycleMin, cycleMax] = [cycleMax, cycleMin];
  }
  if (cycleMin === null && cycleMax !== null) cycleMin = cycleMax;

  let leadsMin = positive(r.statedLeadsPerMonthMin, MAX_LEADS_PER_MONTH);
  let leadsMax = positive(r.statedLeadsPerMonthMax, MAX_LEADS_PER_MONTH);
  if (leadsMin !== null && leadsMax !== null && leadsMax < leadsMin) {
    [leadsMin, leadsMax] = [leadsMax, leadsMin];
  }
  if (leadsMin === null && leadsMax !== null) leadsMin = leadsMax;

  return {
    columnMapping,
    candidateFactors,
    statedCycleDaysMin: cycleMin,
    statedCycleDaysMax: cycleMax,
    statedCycleLabel: text(r.statedCycleLabel, 60),
    statedLeadsPerMonthMin: leadsMin,
    statedLeadsPerMonthMax: leadsMax,
    statedSources: Array.isArray(r.statedSources)
      ? r.statedSources
          .map((s) => text(s, 60))
          .filter((s): s is string => s !== null)
          .slice(0, 8)
      : [],
  };
}
