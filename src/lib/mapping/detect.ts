import { classifyDomain, isValidEmail } from "@/lib/analysis/helpers";

/**
 * Column auto-detection. Deliberately deterministic: header-name matching
 * plus value-pattern sampling, with the reasoning surfaced to the user so
 * they can see why we picked a column rather than trusting a percentage.
 */

export type FieldKey =
  | "createdAt"
  | "closedAt"
  | "outcome"
  | "amount"
  | "currency"
  | "stage"
  | "source"
  | "email"
  | "clickId"
  | "pipeline"
  | "employeeCount"
  | "industry"
  | "contactTitle";

export interface FieldSpec {
  key: FieldKey;
  label: string;
  hint: string;
  required: boolean;
  /** Header substrings that suggest this field, best first. */
  headerHints: string[];
  /**
   * Header substrings that argue *against* this field. An "owner email" column
   * holds the sales rep, not the lead, and mapping it as the lead's email
   * would report a perfect match rate against a single internal address.
   */
  negativeHints?: string[];
  /**
   * Require values to be mostly distinct. A per-lead identifier that repeats
   * on every row is not identifying anything.
   */
  wantsDistinctValues?: boolean;
  /** Share of sampled values that must look right, 0-1. */
  valueTest?: (values: string[]) => number;
}

export interface DetectedField {
  key: FieldKey;
  label: string;
  hint: string;
  required: boolean;
  column: string | null;
  /** 0-1. Null when nothing matched. */
  confidence: number | null;
  /** Plain-English justification shown in the UI beside the badge. */
  reason: string | null;
  /** Distinct values found, for low-cardinality fields like stage. */
  sampleValues?: string[];
  /**
   * Where this mapping came from. Shown in the UI so a suggestion is never
   * mistaken for something we measured.
   */
  source?: "heuristic" | "assistant" | "user";
  /** Set when the assistant and the header heuristics disagreed. */
  disagreement?: string;
}

// ---------------------------------------------------------------------------
// Value pattern tests — each returns the share of values that look right
// ---------------------------------------------------------------------------

function shareMatching(values: string[], test: (v: string) => boolean): number {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return 0;
  return nonEmpty.filter(test).length / nonEmpty.length;
}

/**
 * Date.parse is far too willing — it reads "demo-1042" as a date in the year
 * 1042, which would let a record-ID column pass as a create date. A value has
 * to look like a date before we ask whether it parses as one.
 */
const DATE_SHAPES = [
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}([T ].*)?$/,        // 2026-01-04, 2026-01-04T09:00Z
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}([T ].*)?$/,    // 04/01/2026
  /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/,         // January 4, 2026
  /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/,           // 4 January 2026
];

export function looksLikeDate(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  // Reject bare integers — a year-like 2024 or an ID both parse as dates.
  if (/^\d+$/.test(s)) return false;
  if (!DATE_SHAPES.some((re) => re.test(s))) return false;
  return !Number.isNaN(Date.parse(s));
}

export function looksNumeric(v: string): boolean {
  const s = v.trim().replace(/[$£€,\s]/g, "");
  if (s === "") return false;
  return Number.isFinite(Number(s));
}

export function looksLikeClickId(v: string): boolean {
  const s = v.trim();
  // Google click IDs are long opaque tokens; gbraid/wbraid look similar.
  return s.length >= 20 && /^[A-Za-z0-9_.\-]+$/.test(s);
}

export function looksLikeCurrencyCode(v: string): boolean {
  return /^[A-Z]{3}$/.test(v.trim()) || /^[$£€¥]$/.test(v.trim());
}

// ---------------------------------------------------------------------------
// Field catalogue
// ---------------------------------------------------------------------------

export const FIELD_SPECS: FieldSpec[] = [
  {
    key: "createdAt",
    label: "Create date",
    hint: "when the lead arrived",
    required: true,
    headerHints: ["create", "created", "lead date", "inquiry", "opened", "date added"],
    valueTest: (v) => shareMatching(v, looksLikeDate),
  },
  {
    key: "closedAt",
    label: "Close date",
    hint: "when it was won or lost",
    required: false,
    headerHints: ["close date", "closed", "won date", "date closed", "completion"],
    valueTest: (v) => shareMatching(v, looksLikeDate),
  },
  {
    key: "outcome",
    label: "Outcome",
    hint: "won, lost or still open",
    required: false,
    headerHints: ["outcome", "status", "won", "result", "disposition"],
  },
  {
    key: "amount",
    label: "Deal amount",
    hint: "revenue value",
    required: true,
    headerHints: ["amount", "value", "revenue", "price", "deal size", "total"],
    valueTest: (v) => shareMatching(v, looksNumeric),
  },
  {
    key: "currency",
    label: "Currency",
    hint: "per-row currency code",
    required: false,
    headerHints: ["currency", "curr", "iso currency"],
    valueTest: (v) => shareMatching(v, looksLikeCurrencyCode),
  },
  {
    key: "stage",
    label: "Stage",
    hint: "pipeline position",
    required: true,
    headerHints: ["stage", "dealstage", "phase", "step", "pipeline stage"],
  },
  {
    key: "source",
    label: "Lead source",
    hint: "where it came from",
    required: true,
    headerHints: ["source", "channel", "utm_source", "origin", "campaign"],
  },
  {
    key: "email",
    label: "Email",
    hint: "used to match conversions",
    required: false,
    // Most specific first — "contact email" must outrank a bare "email".
    headerHints: ["contact email", "lead email", "customer email", "email", "e-mail", "mail"],
    negativeHints: ["owner", "rep", "agent", "assigned", "user", "sales", "creator", "manager"],
    wantsDistinctValues: true,
    valueTest: (v) => shareMatching(v, isValidEmail),
  },
  {
    key: "clickId",
    label: "Click ID",
    hint: "ties a lead to an ad click",
    required: false,
    headerHints: ["gclid", "gbraid", "wbraid", "click id", "clickid"],
    wantsDistinctValues: true,
    valueTest: (v) => shareMatching(v, looksLikeClickId),
  },
  {
    key: "pipeline",
    label: "Pipeline",
    hint: "optional grouping",
    required: false,
    headerHints: ["pipeline", "board", "funnel"],
  },
  {
    key: "employeeCount",
    label: "Employee count",
    hint: "optional — unlocks ICP fit check",
    required: false,
    headerHints: ["employee", "headcount", "company size", "staff"],
    valueTest: (v) => shareMatching(v, looksNumeric),
  },
  {
    key: "industry",
    label: "Industry",
    hint: "optional — unlocks ICP fit check",
    required: false,
    headerHints: ["industry", "vertical", "sector"],
  },
  {
    key: "contactTitle",
    label: "Contact title",
    hint: "optional — unlocks ICP fit check",
    required: false,
    headerHints: ["title", "job title", "role", "position"],
  },
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const SAMPLE_SIZE = 200;

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Header score, 0-1. Exact match beats prefix beats substring. */
function headerScore(header: string, hints: string[]): number {
  const h = normalizeHeader(header);
  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i];
    // Later hints are weaker signals than earlier ones.
    const positionPenalty = i * 0.03;
    if (h === hint) return 1 - positionPenalty;
    if (h.startsWith(hint) || h.endsWith(hint)) return 0.9 - positionPenalty;
    if (h.includes(hint)) return 0.75 - positionPenalty;
  }
  return 0;
}

function columnValues(rows: Record<string, string>[], column: string): string[] {
  return rows.slice(0, SAMPLE_SIZE).map((r) => r[column] ?? "");
}

function distinctValues(values: string[], limit = 8): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    const s = v.trim();
    if (s) seen.add(s);
    if (seen.size > limit) break;
  }
  return [...seen];
}

function populatedShare(values: string[]): number {
  if (values.length === 0) return 0;
  return values.filter((v) => v.trim() !== "").length / values.length;
}

/** Distinct non-empty values as a share of non-empty values, 0-1. */
function distinctShare(values: string[]): number {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return 0;
  return new Set(nonEmpty.map((v) => v.trim().toLowerCase())).size / nonEmpty.length;
}

/**
 * Builds the human-readable justification. This is the part that makes the
 * mapping screen feel like the tool read the file rather than pattern-matched
 * a header, so it names the actual evidence.
 */
function buildReason(
  spec: FieldSpec,
  header: string,
  hScore: number,
  vScore: number | null,
  values: string[]
): string {
  const parts: string[] = [];

  if (hScore >= 0.9) parts.push(`header matches "${normalizeHeader(header)}"`);
  else if (hScore > 0) parts.push(`header looks like ${spec.label.toLowerCase()}`);

  if (vScore !== null) {
    const pct = Math.round(vScore * 100);
    if (spec.valueTest === undefined) {
      // no-op
    } else if (spec.key === "createdAt" || spec.key === "closedAt") {
      parts.push(`${pct}% of values parse as dates`);
    } else if (spec.key === "amount" || spec.key === "employeeCount") {
      parts.push(`${pct}% numeric`);
    } else if (spec.key === "email") {
      parts.push(`${pct}% are valid email addresses`);
    } else if (spec.key === "clickId") {
      parts.push(`values match Google click-ID format`);
    } else if (spec.key === "currency") {
      parts.push(`${pct}% are currency codes`);
    }
  }

  const filled = Math.round(populatedShare(values) * 100);
  if (filled < 95) parts.push(`${filled}% populated`);

  const distinct = distinctValues(values);
  if (
    (spec.key === "stage" || spec.key === "source" || spec.key === "outcome") &&
    distinct.length > 0 &&
    distinct.length <= 8
  ) {
    parts.push(`${distinct.length} distinct values`);
  }

  return parts.join(" · ") || "matched on header name";
}

/**
 * Stage-timing columns are dynamic — one per stage — so they're detected
 * separately from the fixed field list.
 *
 * Two shapes are recognized, because CRMs export one or the other:
 *   duration  — "time_in_stage_qualified", "days_in_proposal" (how long spent)
 *   entered   — "date_entered_qualified", "qualified_date"    (when reached)
 *
 * Durations feed the backfill trust check; entered-dates feed early-gate
 * detection. Neither is inferred from the other.
 */
export interface StageTimingColumn {
  column: string;
  stage: string;
  kind: "duration" | "entered";
  /** For durations: the unit the values are in. */
  unit?: "seconds" | "days";
}

const DURATION_PATTERNS = [
  /^time[ _]in[ _]stage[ _](.+)$/i,
  /^time[ _]in[ _](.+)$/i,
  /^(?:days|hours|seconds)[ _]in[ _](?:stage[ _])?(.+)$/i,
  /^(.+)[ _]duration$/i,
];

const ENTERED_PATTERNS = [
  /^date[ _]entered[ _](.+)$/i,
  /^entered[ _](.+)$/i,
  /^(.+)[ _]entered[ _]date$/i,
  /^(.+)[ _]stage[ _]date$/i,
];

function titleize(raw: string): string {
  return raw
    .replace(/[_\-.]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function detectStageTimingColumns(
  headers: string[],
  rows: Record<string, string>[]
): StageTimingColumn[] {
  const out: StageTimingColumn[] = [];

  for (const header of headers) {
    const norm = header.toLowerCase().trim();

    for (const re of DURATION_PATTERNS) {
      const m = norm.match(re);
      if (!m) continue;
      const values = columnValues(rows, header);
      // Must actually be numeric, or it's a name that merely looks like one.
      if (shareMatching(values, looksNumeric) < 0.6) break;
      const unit = /^(?:days|hours)[ _]in[ _]/i.test(norm) ? "days" : "seconds";
      out.push({ column: header, stage: titleize(m[1]), kind: "duration", unit });
      break;
    }

    for (const re of ENTERED_PATTERNS) {
      const m = norm.match(re);
      if (!m) continue;
      const values = columnValues(rows, header);
      if (shareMatching(values, looksLikeDate) < 0.5) break;
      out.push({ column: header, stage: titleize(m[1]), kind: "entered" });
      break;
    }
  }

  return out;
}

export interface DetectionResult {
  fields: DetectedField[];
  /** Columns in the file that no field claimed. */
  unmapped: string[];
}

/**
 * Assigns each field its best-matching column. A column is claimed by at most
 * one field: the field that scored it highest wins, so an "amount" and an
 * "employee count" column can't both resolve to the same numeric field.
 */
export function detectColumns(
  headers: string[],
  rows: Record<string, string>[]
): DetectionResult {
  // Score every (field, column) pair first, then resolve conflicts globally.
  interface Candidate {
    spec: FieldSpec;
    column: string;
    score: number;
    hScore: number;
    vScore: number | null;
  }

  const candidates: Candidate[] = [];

  for (const spec of FIELD_SPECS) {
    for (const column of headers) {
      const hScore = headerScore(column, spec.headerHints);
      if (hScore === 0) continue;

      const values = columnValues(rows, column);
      const vScore = spec.valueTest ? spec.valueTest(values) : null;

      // A header hint with contradicting values is not a match. Dates and
      // numbers are the cases where a wrong pick silently corrupts the whole
      // analysis, so they must clear a floor.
      if (vScore !== null && vScore < 0.5) continue;

      // Weight header and value evidence together; when there's no value test
      // to run, the header carries it alone at a discount.
      let score = vScore === null ? hScore * 0.85 : hScore * 0.55 + vScore * 0.45;

      // A header naming someone internal ("owner email") describes staff, not
      // the lead. Heavy penalty rather than exclusion, so it can still win if
      // it's genuinely the only candidate.
      const normalized = normalizeHeader(column);
      if (spec.negativeHints?.some((neg) => normalized.includes(neg))) {
        score *= 0.25;
      }

      // An identifier column that repeats the same value is not identifying
      // anyone — this is what separates a lead's email from the rep's.
      if (spec.wantsDistinctValues) {
        const distinct = distinctShare(values);
        if (distinct < 0.5) score *= 0.2 + distinct;
      }

      candidates.push({ spec, column, score, hScore, vScore });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const claimedColumns = new Set<string>();
  const resolved = new Map<FieldKey, Candidate>();

  for (const c of candidates) {
    if (resolved.has(c.spec.key)) continue;
    if (claimedColumns.has(c.column)) continue;
    resolved.set(c.spec.key, c);
    claimedColumns.add(c.column);
  }

  const fields: DetectedField[] = FIELD_SPECS.map((spec) => {
    const match = resolved.get(spec.key);
    if (!match) {
      return {
        key: spec.key,
        label: spec.label,
        hint: spec.hint,
        required: spec.required,
        column: null,
        confidence: null,
        reason: null,
        source: "heuristic",
      };
    }
    const values = columnValues(rows, match.column);
    return {
      key: spec.key,
      label: spec.label,
      hint: spec.hint,
      required: spec.required,
      column: match.column,
      confidence: Math.min(0.99, Math.round(match.score * 100) / 100),
      reason: buildReason(spec, match.column, match.hScore, match.vScore, values),
      sampleValues: distinctValues(values),
      source: "heuristic",
    };
  });

  return {
    fields,
    unmapped: headers.filter((h) => !claimedColumns.has(h)),
  };
}

// ---------------------------------------------------------------------------
// File-level issues surfaced before analysis
// ---------------------------------------------------------------------------

export interface FileIssue {
  kind: "mixed_currency" | "missing_value" | "duplicates" | "low_identifiers";
  severity: "warn" | "info";
  title: string;
  detail: string;
  count: number;
  /** Row indices, so the UI can show the offending rows. */
  rowIndices: number[];
  /** For mixed_currency: the codes actually present, most common first. */
  currencies?: { code: string; count: number }[];
}

export function findFileIssues(
  rows: Record<string, string>[],
  fields: DetectedField[]
): FileIssue[] {
  const issues: FileIssue[] = [];
  const col = (key: FieldKey) => fields.find((f) => f.key === key)?.column ?? null;

  // Mixed currency — never silently converted; the user picks a rate.
  const currencyCol = col("currency");
  if (currencyCol) {
    const counts = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const v = (r[currencyCol] ?? "").trim().toUpperCase();
      if (!v) return;
      const bucket = counts.get(v);
      if (bucket) bucket.push(i);
      else counts.set(v, [i]);
    });
    if (counts.size > 1) {
      const sorted = [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
      const minority = sorted.slice(1);
      const minorityRows = minority.flatMap(([, idx]) => idx);
      issues.push({
        kind: "mixed_currency",
        severity: "warn",
        title: `${counts.size} currencies in this file`,
        detail: sorted
          .map(([code, idx]) => `${code} ${idx.length.toLocaleString()}`)
          .join(" · ") +
          " — pick a reporting currency and a rate, or exclude the minority rows.",
        count: minorityRows.length,
        rowIndices: minorityRows,
        currencies: sorted.map(([code, idx]) => ({ code, count: idx.length })),
      });
    }
  }

  // Missing values in fields the analysis depends on.
  for (const key of ["amount", "createdAt"] as FieldKey[]) {
    const column = col(key);
    if (!column) continue;
    const missing: number[] = [];
    rows.forEach((r, i) => {
      if (!(r[column] ?? "").trim()) missing.push(i);
    });
    if (missing.length > 0) {
      const label = fields.find((f) => f.key === key)!.label.toLowerCase();
      issues.push({
        kind: "missing_value",
        severity: "info",
        title: `${missing.length.toLocaleString()} rows have no ${label}`,
        detail:
          key === "amount"
            ? "They'll be excluded from value calculations. We never estimate a missing amount."
            : "Without it we can't measure your sales cycle, so these are excluded.",
        count: missing.length,
        rowIndices: missing,
      });
    }
  }

  // Exact duplicates across all columns.
  const seen = new Map<string, number>();
  const dupes: number[] = [];
  rows.forEach((r, i) => {
    const sig = JSON.stringify(r);
    if (seen.has(sig)) dupes.push(i);
    else seen.set(sig, i);
  });
  if (dupes.length > 0) {
    issues.push({
      kind: "duplicates",
      severity: "info",
      title: `${dupes.length.toLocaleString()} exact duplicate rows`,
      detail: "Identical across every column. We keep the first of each and drop the rest.",
      count: dupes.length,
      rowIndices: dupes,
    });
  }

  // Identifier coverage, flagged early so it isn't a surprise in the report.
  const emailCol = col("email");
  const clickCol = col("clickId");
  if (emailCol || clickCol) {
    const without: number[] = [];
    rows.forEach((r, i) => {
      const hasClick = clickCol ? !!(r[clickCol] ?? "").trim() : false;
      const hasEmail = emailCol ? isValidEmail(r[emailCol]) : false;
      if (!hasClick && !hasEmail) without.push(i);
    });
    const rate = rows.length > 0 ? 1 - without.length / rows.length : 0;
    if (rate < 0.4 && rows.length > 0) {
      issues.push({
        kind: "low_identifiers",
        severity: "warn",
        title: `Only ${Math.round(rate * 100)}% of rows can be matched to an ad click`,
        detail:
          "Value-based bidding needs a click ID or a usable email per lead. Below 40%, there isn't enough to bid on — the tracking snippet fixes this going forward.",
        count: without.length,
        rowIndices: without,
      });
    }
  }

  return issues;
}

export { classifyDomain };
