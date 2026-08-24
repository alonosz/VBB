import { isValidEmail } from "@/lib/analysis/helpers";
import { looksLikeClickId, looksLikeCurrencyCode, looksLikeDate, looksNumeric } from "@/lib/mapping/detect";

/**
 * Column profiling for the intake call.
 *
 * The assistant needs to know what each column *is* — not what is in it. A
 * profile carries the header, the shape of its values and how varied they are;
 * it never carries a customer's email, a person's name, or a deal amount.
 * That is what lets the upload screen keep its promise that the file stays on
 * the user's machine.
 */

export type ColumnKind =
  | "empty"
  | "date"
  | "number"
  | "currencyCode"
  | "email"
  | "opaqueToken"
  | "categorical"
  | "freeText";

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  /** Share of rows with a value, 0-1. */
  fillRate: number;
  distinctCount: number;
  /** Distinct values as a share of filled rows, 0-1. */
  distinctShare: number;
  /**
   * A few distinct values, present only for low-cardinality categorical
   * columns whose header does not name a person, company or contact detail.
   */
  exampleValues?: string[];
  /** Digit counts for numeric columns — enough to tell an amount from a headcount. */
  numericShape?: { minDigits: number; maxDigits: number; hasDecimals: boolean };
  /** ISO days, so create dates and close dates are distinguishable. */
  dateSpanDays?: number;
  /** Set when values were withheld, with the reason shown to the user. */
  withheld?: string;
}

/** Headers whose values are personal or commercially sensitive, whatever they look like. */
const SENSITIVE_HEADER_HINTS = [
  "email", "e-mail", "mail",
  "name", "first", "last", "contact", "person", "owner", "rep",
  "phone", "mobile", "tel", "fax",
  "address", "street", "city", "postcode", "zip", "state", "country",
  "company", "account", "organisation", "organization", "employer", "domain", "website", "url",
  "amount", "value", "revenue", "arr", "mrr", "price", "deal size", "budget",
  "note", "comment", "description", "message", "detail", "reason", "feedback",
  "ip", "gclid", "click", "id",
];

const MAX_EXAMPLES = 8;
const MAX_CATEGORICAL_DISTINCT = 30;
const MAX_EXAMPLE_LENGTH = 40;

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-.]+/g, " ").trim();
}

function isSensitiveHeader(header: string): boolean {
  const n = normalizeHeader(header);
  return SENSITIVE_HEADER_HINTS.some((hint) => n.includes(hint));
}

function shareMatching(values: string[], test: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(test).length / values.length;
}

/**
 * A category label is short and repeats. Both halves matter: a small file can
 * show every stage exactly once, and a long sentence is never a label however
 * often it recurs.
 */
function isCategorical(values: string[], distinctCount: number, distinctShare: number): boolean {
  if (distinctCount > MAX_CATEGORICAL_DISTINCT) return false;
  if (shareMatching(values, (v) => v.length <= MAX_EXAMPLE_LENGTH) < 0.9) return false;
  return distinctShare <= 0.3 || distinctCount <= 12;
}

function classify(values: string[], distinctCount: number, distinctShare: number): ColumnKind {
  if (values.length === 0) return "empty";
  if (shareMatching(values, isValidEmail) >= 0.7) return "email";
  if (shareMatching(values, looksLikeDate) >= 0.7) return "date";
  if (shareMatching(values, looksLikeCurrencyCode) >= 0.7) return "currencyCode";
  if (shareMatching(values, looksNumeric) >= 0.7) return "number";
  if (shareMatching(values, looksLikeClickId) >= 0.7) return "opaqueToken";
  if (isCategorical(values, distinctCount, distinctShare)) return "categorical";
  return "freeText";
}

function numericShape(values: string[]): ColumnProfile["numericShape"] {
  let minDigits = Infinity;
  let maxDigits = 0;
  let hasDecimals = false;
  for (const v of values) {
    const cleaned = v.trim().replace(/[$£€,\s]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) continue;
    if (cleaned.includes(".")) hasDecimals = true;
    const digits = Math.abs(Math.trunc(n)).toString().length;
    minDigits = Math.min(minDigits, digits);
    maxDigits = Math.max(maxDigits, digits);
  }
  if (maxDigits === 0) return undefined;
  return { minDigits: minDigits === Infinity ? maxDigits : minDigits, maxDigits, hasDecimals };
}

function dateSpanDays(values: string[]): number | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    const t = Date.parse(v.trim());
    if (Number.isNaN(t)) continue;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  if (hi < lo) return undefined;
  return Math.round((hi - lo) / 86_400_000);
}

/**
 * Builds one profile per column. Nothing here is sent anywhere on its own —
 * the caller decides — but everything here is safe to send.
 */
export function profileColumns(
  headers: string[],
  rows: Record<string, string>[]
): ColumnProfile[] {
  return headers.map((name) => {
    const filled = rows
      .map((r) => (r[name] ?? "").trim())
      .filter((v) => v !== "");
    const distinct = new Set(filled);
    const fillRate = rows.length > 0 ? filled.length / rows.length : 0;
    const distinctShare = filled.length > 0 ? distinct.size / filled.length : 0;
    const kind = classify(filled, distinct.size, distinctShare);

    const profile: ColumnProfile = {
      name,
      kind,
      fillRate: Math.round(fillRate * 100) / 100,
      distinctCount: distinct.size,
      distinctShare: Math.round(distinctShare * 100) / 100,
    };

    if (kind === "number") profile.numericShape = numericShape(filled);
    if (kind === "date") profile.dateSpanDays = dateSpanDays(filled);

    // Example values are the strongest mapping signal, so we give as many as
    // we safely can: short, repeated, non-identifying category labels only.
    if (isSensitiveHeader(name)) {
      profile.withheld = "header names personal or commercial data";
    } else if (kind === "email" || kind === "opaqueToken") {
      profile.withheld = "values identify a person or a click";
    } else if (kind === "freeText") {
      profile.withheld = "values are free text and may contain anything";
    } else if (kind === "categorical" && distinct.size <= MAX_CATEGORICAL_DISTINCT) {
      const examples = [...distinct]
        .filter((v) => v.length <= MAX_EXAMPLE_LENGTH)
        .slice(0, MAX_EXAMPLES);
      if (examples.length > 0) profile.exampleValues = examples;
      else profile.withheld = "values are too long to be category labels";
    } else if (kind === "categorical") {
      profile.withheld = `${distinct.size} distinct values — too many to be category labels`;
    }

    return profile;
  });
}

/** What the user is told we send. Kept next to the code that does the sending. */
export function describeWhatIsSent(profiles: ColumnProfile[]): {
  columns: number;
  withExamples: number;
  withheld: number;
} {
  return {
    columns: profiles.length,
    withExamples: profiles.filter((p) => p.exampleValues?.length).length,
    withheld: profiles.filter((p) => p.withheld).length,
  };
}
