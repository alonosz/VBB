import type { DetectedField } from "@/lib/mapping/detect";
import { profileColumns } from "./profile";

/**
 * Sorting a free-text column into categories, as an opt-in experiment.
 *
 * The engine prices on columns whose values repeat: a product line, a case
 * type, a region. A column where every row is different - the message a lead
 * typed into the form - is refused by discovery because no level in it could
 * ever reach the 25 deals a rule needs. Yet that message is often the only
 * place the lead says what they actually want, and it is written at the
 * moment of enquiry, which makes it a day-0 signal of exactly the kind the
 * tool exists to price.
 *
 * So a model reads each message and puts it in one of a few buckets. Never
 * a value, never a score: a label, which becomes a column like any other and
 * clears the same sample-size and lift thresholds or is dropped with a
 * reason. The AI sorts; the advertiser's deals decide whether the sorting
 * meant anything.
 *
 * This is the one place text from the file leaves the browser, so it is off
 * until the advertiser turns it on for a named column, and what leaves is
 * scrubbed of addresses, phone numbers and identifiers first.
 */

/** Below this fill, too few leads wrote anything for the sorting to matter. */
export const SORT_MIN_FILL = 0.3;
/** Longer messages carry nothing a label needs, and cost tokens. */
export const MAX_TEXT_CHARS = 300;
/** Texts per request. Small enough to answer inside a route's time limit. */
export const SORT_BATCH = 120;
/** Buckets the model may propose. More than this and no bucket reaches 25 deals. */
export const MAX_LABELS = 8;
/** The bucket for anything that fits none of the others. Always present. */
export const OTHER_LABEL = "Other";

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
/** Seven or more digits with optional separators: a phone, an account, a policy number. */
const PHONE_OR_ID = /(?:\+?\d[\d\s().-]{5,}\d)/g;
const LONG_DIGITS = /\d{5,}/g;

/**
 * What may leave the browser: the message minus anything that identifies
 * the person. An address, a phone number, a policy number or a URL carries
 * nothing a bucket needs, so it is removed rather than trusted to the model.
 */
export function scrubText(raw: string): string {
  return raw
    .replace(EMAIL, " ")
    .replace(URL, " ")
    .replace(PHONE_OR_ID, " ")
    .replace(LONG_DIGITS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export interface SortableColumn {
  column: string;
  /** Share of rows carrying text, 0-1. */
  fill: number;
}

/**
 * Headers whose free text is the person, not what they want. A column of
 * names, addresses or identifiers is free text too, and there is nothing in
 * it to sort: it is never offered, whatever its shape.
 */
const PERSON_HINTS = [
  "email", "e-mail", "mail", "name", "first", "last", "contact", "person", "owner", "rep",
  "phone", "mobile", "tel", "fax", "address", "street", "city", "postcode", "zip",
  "ip", "gclid", "click", "id", "url", "website", "domain", "company", "account",
];

function identifiesPerson(header: string): boolean {
  const tokens = header.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return PERSON_HINTS.some((hint) => tokens.includes(hint) || (hint.length > 3 && header.toLowerCase().includes(hint)));
}

/**
 * The columns worth offering: unmapped, mostly different from row to row,
 * written on enough leads to matter, and about the enquiry rather than the
 * person.
 */
export function sortableColumns(
  headers: string[],
  rows: Record<string, string>[],
  fields: DetectedField[]
): SortableColumn[] {
  const claimed = new Set(fields.map((f) => f.column).filter((c): c is string => !!c));
  return profileColumns(headers, rows)
    .filter((p) => p.kind === "freeText" && !claimed.has(p.name) && !identifiesPerson(p.name))
    .filter((p) => p.fillRate >= SORT_MIN_FILL)
    .map((p) => ({ column: p.name, fill: p.fillRate }));
}

/** Whether a header is one this sorting produced. */
export function isSortedHeader(header: string): boolean {
  return header.endsWith(" (AI sorted)");
}

/** The column the sorting becomes, named so the report says where it came from. */
export function sortedHeader(column: string): string {
  return `${column} (AI sorted)`;
}

/** The distinct scrubbed texts of a column, in first-seen order. */
export function textsOf(rows: Record<string, string>[], column: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const t = scrubText(row[column] ?? "");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export interface SortedColumn {
  /** The free-text column that was read. */
  source: string;
  /** The column the labels went into. */
  header: string;
  labels: string[];
  /** Distinct messages that were sent. */
  texts: number;
}

/**
 * The file with the labels added as a column. A row whose text got no
 * label, or wrote nothing, is blank there, exactly as an empty cell in any
 * other column: missing, never guessed.
 */
export function applySortedColumn(
  file: { headers: string[]; rows: Record<string, string>[] },
  column: string,
  byText: Record<string, string>
): { headers: string[]; rows: Record<string, string>[] } {
  const header = sortedHeader(column);
  return {
    headers: file.headers.includes(header) ? file.headers : [...file.headers, header],
    rows: file.rows.map((row) => ({ ...row, [header]: byText[scrubText(row[column] ?? "")] ?? "" })),
  };
}

/** The file with a sorted column taken out again. */
export function removeSortedColumn(
  file: { headers: string[]; rows: Record<string, string>[] },
  header: string
): { headers: string[]; rows: Record<string, string>[] } {
  return {
    headers: file.headers.filter((h) => h !== header),
    rows: file.rows.map((row) => {
      const next = { ...row };
      delete next[header];
      return next;
    }),
  };
}

// ---------------------------------------------------------------------------
// The model's answer, before anything is believed
// ---------------------------------------------------------------------------

export interface SortAnswer {
  labels: string[];
  /** One per text sent, null where the model gave nothing usable. */
  assignments: (string | null)[];
}

const MAX_LABEL_CHARS = 32;

function cleanLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t === "" ? null : t.slice(0, MAX_LABEL_CHARS);
}

/**
 * Turns the model's answer into labels the file can carry.
 *
 * The label set is fixed once proposed: a later batch may only use labels
 * from it, or its rows would be sorted against a different list from the
 * first batch's. Anything outside the set, or pointing at a text that was
 * not sent, is dropped rather than defended against downstream.
 */
export function sanitizeSortAnswer(raw: unknown, textCount: number, fixedLabels: string[] | null): SortAnswer {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let labels: string[];
  if (fixedLabels) {
    labels = fixedLabels;
  } else {
    const proposed = Array.isArray(r.labels) ? r.labels.map(cleanLabel).filter((l): l is string => l !== null) : [];
    const unique: string[] = [];
    for (const l of proposed) {
      if (l.toLowerCase() === OTHER_LABEL.toLowerCase()) continue;
      if (unique.some((u) => u.toLowerCase() === l.toLowerCase())) continue;
      unique.push(l);
      if (unique.length >= MAX_LABELS - 1) break;
    }
    labels = [...unique, OTHER_LABEL];
  }
  const allowed = new Map(labels.map((l) => [l.toLowerCase(), l]));

  const assignments: (string | null)[] = Array(textCount).fill(null);
  if (Array.isArray(r.assignments)) {
    for (const entry of r.assignments) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const index = typeof e.index === "number" && Number.isInteger(e.index) ? e.index : -1;
      if (index < 0 || index >= textCount) continue;
      const label = cleanLabel(e.label);
      const match = label ? allowed.get(label.toLowerCase()) : undefined;
      if (!match) continue;
      assignments[index] = match;
    }
  }
  return { labels, assignments };
}
