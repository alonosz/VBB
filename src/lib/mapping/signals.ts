import type { DetectedField } from "./detect";
import { looksLikeDate, looksNumeric } from "./detect";

/**
 * Finding the columns that could price a lead, without being told.
 *
 * Until now a column became a value signal in exactly one way: the intake
 * call named it. That call runs once, waits three seconds, and does not run
 * at all without an API key. So a consumer lead-gen file - case type, product
 * line, coverage band, the columns that carry all of its signal - got no
 * factors unless the model happened to mention them, and the four built-in
 * factors are B2B and never fire on it. The product priced every consumer
 * lead the same, which is the failure it exists to prevent.
 *
 * This reads the file instead. Any column nothing else has claimed, whose
 * values look like a short list of categories, becomes a candidate. The engine
 * then tests it against closed deals under the same sample-size and lift
 * thresholds as everything else and drops the ones that carry nothing. The
 * assistant still adds the advertiser's claims on top; it stops being the only
 * way a column gets noticed.
 *
 * Deterministic, like the rest of detection. A column is a candidate because
 * of its shape, and the reason is written down beside it.
 */

/** Rows read to judge a column's shape. Matches detection's own sample. */
const SAMPLE_SIZE = 200;

/** Below this, a column is mostly blank and any level in it is thin. */
export const MIN_FILL = 0.5;

/** One value is a constant, not a category. */
export const MIN_LEVELS = 2;

/**
 * Above this it is free text, a name, or an identifier. The engine needs 25
 * resolved deals behind a level to price it, so a column with 40 levels on a
 * 500-row file would never clear that anyway.
 */
export const MAX_LEVELS = 12;

export interface DiscoveredSignal {
  column: string;
  /** Distinct values in the sample. */
  levels: number;
  /** Share of sampled rows carrying a value, 0-1. */
  fill: number;
  /** Why it was picked, in the words the mapping screen uses. */
  reason: string;
}

export interface RefusedColumn {
  column: string;
  reason: string;
}

/**
 * Columns that are never a factor, whatever the data says.
 *
 * Google's personalised advertising policy restricts targeting on credit,
 * health, and other sensitive categories, and discrimination law reaches
 * further than that. A bid that is higher for one age or one credit band is
 * exactly what those rules forbid, and it is also exactly what this product
 * would do with such a column if it were allowed to price on it. So it is not
 * allowed to, and the report says why. The advertiser keeps case type, product
 * line, coverage requested - the columns that carry the value without
 * carrying the person.
 */
const PROTECTED: { hints: string[]; what: string }[] = [
  { hints: ["age", "dob", "date of birth", "birth", "birthday"], what: "age" },
  { hints: ["gender", "sex"], what: "gender" },
  { hints: ["race", "ethnic"], what: "race or ethnicity" },
  { hints: ["religion", "faith"], what: "religion" },
  { hints: ["disab", "handicap"], what: "disability" },
  { hints: ["health", "medical", "diagnos", "condition", "pregnan"], what: "health" },
  { hints: ["credit score", "credit band", "fico", "credit rating", "creditscore"], what: "credit" },
  { hints: ["marital", "married"], what: "marital status" },
  { hints: ["citizen", "immigration status", "national origin", "nationality"], what: "national origin" },
  { hints: ["sexual", "orientation"], what: "sexual orientation" },
  { hints: ["veteran", "military"], what: "veteran status" },
  { hints: ["ssn", "social security", "national id", "passport"], what: "an identity number" },
];

/**
 * Columns that describe the record or the rep rather than the lead. A rep's
 * name splits every file into "leads Dana worked" and "leads Sam worked",
 * which the engine would happily price and which means nothing at bid time.
 */
const NOT_ABOUT_THE_LEAD = [
  "owner", "rep", "assigned", "agent name", "account manager", "created by", "modified by",
  "note", "comment", "description", "url", "link", "id", "uuid", "phone", "mobile",
  "first name", "last name", "full name", "name", "address", "street", "postcode", "zip",
  "timestamp", "updated", "modified",
];

function normalize(h: string): string {
  return h.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Short hints match a whole word only: "age" must not catch "coverage" or
 * "percentage", and "sex" must not catch "essex". Longer hints and phrases
 * may match inside a word, so "birth" still catches "birthday" and
 * "date_of_birth" and "disab" still catches "disability".
 */
function mentions(header: string, hint: string): boolean {
  if (header === hint) return true;
  if (hint.length < 5 && !hint.includes(" ")) return header.split(" ").includes(hint);
  return header.includes(hint);
}

export function protectedReason(header: string): string | null {
  const h = normalize(header);
  for (const { hints, what } of PROTECTED) {
    if (hints.some((hint) => mentions(h, hint))) {
      return (
        `"${header}" looks like ${what}. We never price a lead on it: Google's ` +
        "personalised advertising rules and discrimination law both forbid bidding " +
        "differently on it, so it is left out however strongly it predicts."
      );
    }
  }
  return null;
}

function aboutTheRecord(header: string): boolean {
  const h = normalize(header);
  return NOT_ABOUT_THE_LEAD.some((hint) => h === hint || h.split(" ").includes(hint) || h.endsWith(` ${hint}`));
}

function sampled(rows: Record<string, string>[], column: string): string[] {
  return rows.slice(0, SAMPLE_SIZE).map((r) => (r[column] ?? "").trim());
}

/**
 * @param fields The mapping as it stands. A column a field has claimed is
 *   structural (a date, an amount, a stage) and never a category to price on.
 */
export function discoverSignalColumns(
  headers: string[],
  rows: Record<string, string>[],
  fields: DetectedField[]
): { discovered: DiscoveredSignal[]; refused: RefusedColumn[] } {
  const claimed = new Set(fields.map((f) => f.column).filter((c): c is string => !!c));
  const discovered: DiscoveredSignal[] = [];
  const refused: RefusedColumn[] = [];

  for (const column of headers) {
    if (claimed.has(column)) continue;

    /*
     * Refused before the shape is examined, so a protected column with a
     * perfect categorical shape is still refused - and refused visibly, rather
     * than silently skipped as if it had been too thin.
     */
    const forbidden = protectedReason(column);
    if (forbidden) {
      refused.push({ column, reason: forbidden });
      continue;
    }
    if (aboutTheRecord(column)) continue;

    const values = sampled(rows, column);
    const present = values.filter((v) => v !== "");
    if (values.length === 0) continue;
    const fill = present.length / values.length;
    if (fill < MIN_FILL) continue;

    // Dates and amounts are structural even when unmapped. A category is
    // words, or codes, not a measurement.
    const numericShare = present.filter(looksNumeric).length / present.length;
    const dateShare = present.filter(looksLikeDate).length / present.length;
    if (numericShare > 0.8 || dateShare > 0.8) continue;

    const levels = new Set(present.map((v) => v.toLowerCase())).size;
    if (levels < MIN_LEVELS || levels > MAX_LEVELS) continue;

    discovered.push({
      column,
      levels,
      fill,
      reason: `${levels} distinct values across ${Math.round(fill * 100)}% of rows, so it reads as a category worth testing`,
    });
  }

  return { discovered, refused };
}

/**
 * The columns the engine will test, from both readers.
 *
 * The assistant's candidates come first because they carry a claim to answer;
 * the discovered ones fill in behind them. A column in both is one column.
 */
export function signalColumnsFor(
  intakeKeys: string[],
  discovered: DiscoveredSignal[]
): string[] {
  const out = [...intakeKeys];
  for (const d of discovered) if (!out.includes(d.column)) out.push(d.column);
  return out;
}
