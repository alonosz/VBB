import type { DetectedField } from "./detect";
import { looksLikeDate, looksNumeric } from "./detect";
import { readOutcome, type OutcomeOverrides } from "./outcomes";
import type { Audience, DealOutcome } from "@/lib/analysis/types";

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
 * Above this a column is offered but not suggested. The engine needs 25
 * resolved deals behind a level to price one, so a column with 40 levels on a
 * 500-row file rarely clears that - but "rarely" is the advertiser's call to
 * overrule, not ours to make final.
 */
export const MAX_LEVELS = 12;

/**
 * Above this share of distinct values a column is not offered at all.
 *
 * A ticket number, a free-text note, or a name has close to one distinct
 * value per row. That is an identifier, not a category, and there is nothing
 * for anybody to overrule: no level would ever have 25 deals behind it. This
 * is the line between "we think this is unlikely" and "this is not that kind
 * of column".
 */
export const MAX_DISTINCT_SHARE = 0.5;

/**
 * The fields that describe a company rather than a lead. Detection maps them
 * on any file whose headers look right, and the mapping screen, the factor
 * list and discovery all have to agree on what happens to them for a
 * consumer: hidden, dropped, and handed back to discovery, in that order.
 */
export const COMPANY_FIELD_KEYS = ["employeeCount", "industry", "contactTitle"] as const;

export interface DiscoveredSignal {
  column: string;
  /** Distinct values in the sample. */
  levels: number;
  /** Share of sampled rows carrying a value, 0-1. */
  fill: number;
  /**
   * True when the column's shape cleared the thresholds, so it is tested
   * unless the advertiser turns it off. False when it did not, so it is
   * offered and left off unless they turn it on.
   */
  suggested: boolean;
  /** What its shape is, in the words the mapping screen uses. */
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

/**
 * Columns written after the outcome is known.
 *
 * HubSpot ships "Closed Lost Reason" by default; Salesforce and Pipedrive
 * have their own. Each is a short category, so discovery would suggest it,
 * and it would show the strongest lift in the file - because it is filled
 * in when the deal is lost, not when the lead arrives. Priced on, it enters
 * the model with a huge multiplier, and then every new lead has it blank, so
 * the multiplier never fires and the calibration was fitted against a
 * column that is always empty at bid time. The report looks right and the
 * feed bids wrong every night, and nothing on either screen says so.
 *
 * Two readers catch it. The header, for the names every CRM uses. And the
 * fill pattern, for the ones nobody named: a column near-empty on open
 * leads and near-full on resolved ones is an outcome, whatever it is called.
 */
const OUTCOME_DERIVED = [
  "lost reason", "loss reason", "reason lost", "closed reason", "close reason",
  "reason closed", "won reason", "win reason", "reason won", "churn reason",
  "cancel reason", "cancellation reason", "disqualif", "rejection reason",
  "decline reason", "outcome reason", "reason for loss", "reason for closing",
];

/** Below this share of open leads carrying a value, the column is written at resolution. */
export const LEAK_MAX_OPEN_FILL = 0.1;
/** Above this share of resolved leads carrying a value, it is written reliably then. */
export const LEAK_MIN_RESOLVED_FILL = 0.5;
/** Open and resolved leads each needed before the fill pattern is trusted. */
export const LEAK_MIN_GROUP = 20;

function outcomeDerivedByName(header: string): boolean {
  const h = normalize(header);
  return OUTCOME_DERIVED.some((hint) => h.includes(hint));
}

function leakReason(column: string, detail: string): string {
  return (
    `"${column}" is ${detail}, so it is written after the outcome is known. It would ` +
    "look like the strongest signal in the file and then never be there on a new " +
    "lead, and every multiplier would be set against a column that is blank at bid time."
  );
}

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
 * @param audience Decides whether the company fields count as a claim.
 */
export function discoverSignalColumns(
  headers: string[],
  rows: Record<string, string>[],
  fields: DetectedField[],
  audience: Audience = "b2b",
  outcomeOverrides: OutcomeOverrides = {}
): { discovered: DiscoveredSignal[]; refused: RefusedColumn[] } {
  /*
   * A consumer file with a column that happens to be called "industry" or
   * "title" used to lose it three times over: the mapping screen hid the
   * field, the factor list dropped it for the audience, and discovery
   * skipped the column because the field still claimed it. A file that
   * carried real signal in that column was priced flat, and nothing on
   * screen said why. For consumers those fields claim nothing.
   */
  const inert: readonly string[] = audience === "b2c" ? COMPANY_FIELD_KEYS : [];
  const claimed = new Set(
    fields
      .filter((f) => !inert.includes(f.key))
      .map((f) => f.column)
      .filter((c): c is string => !!c)
  );
  const discovered: DiscoveredSignal[] = [];
  const refused: RefusedColumn[] = [];

  /*
   * The outcome of every row, read the same way the engine reads it, so the
   * fill pattern below is judged against what "resolved" will actually mean
   * once the file is priced.
   */
  const colOf = (key: string) => fields.find((f) => f.key === key)?.column ?? null;
  const cOutcome = colOf("outcome");
  const cStage = colOf("stage");
  const outcomes: DealOutcome[] = rows.map((r) =>
    readOutcome(cOutcome ? r[cOutcome] : undefined, cStage ? r[cStage] : undefined, outcomeOverrides)
  );
  const openIdx: number[] = [];
  const resolvedIdx: number[] = [];
  outcomes.forEach((o, i) => (o === "open" ? openIdx : resolvedIdx).push(i));
  const fillOn = (column: string, idx: number[]) =>
    idx.length === 0 ? 0 : idx.filter((i) => (rows[i][column] ?? "").trim() !== "").length / idx.length;

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
    if (outcomeDerivedByName(column)) {
      refused.push({ column, reason: leakReason(column, "a reason recorded when a deal closes") });
      continue;
    }
    if (aboutTheRecord(column)) continue;

    const values = sampled(rows, column);
    const present = values.filter((v) => v !== "");
    if (values.length === 0 || present.length === 0) continue;
    const fill = present.length / values.length;

    // Dates and amounts are structural even when unmapped. A category is
    // words, or codes, not a measurement. This one is a hard exclusion
    // rather than a threshold: a column of timestamps has a level per row
    // and there is nothing for the advertiser to overrule.
    const numericShare = present.filter(looksNumeric).length / present.length;
    const dateShare = present.filter(looksLikeDate).length / present.length;
    if (numericShare > 0.8 || dateShare > 0.8) continue;

    const levels = new Set(present.map((v) => v.toLowerCase())).size;
    if (levels < MIN_LEVELS) continue;
    if (levels / present.length > MAX_DISTINCT_SHARE) continue;

    /*
     * Offered either way, and suggested only when the shape clears both
     * thresholds. The thresholds are a judgement about what usually carries
     * signal, not a fact about this file: a column filled on 45% of rows or
     * carrying 15 case types can be the most important thing in it. Hiding
     * those made my guess final, which principle 3 does not allow. Turned on,
     * they meet the same sample-size and lift tests as everything else, and
     * get dropped with a reason if they carry nothing.
     */
    /*
     * The fill pattern, for outcome columns nobody named. Judged only when
     * both groups are big enough to mean something: a file of resolved deals
     * alone cannot show the pattern, and is not refused on a guess.
     */
    if (openIdx.length >= LEAK_MIN_GROUP && resolvedIdx.length >= LEAK_MIN_GROUP) {
      const onOpen = fillOn(column, openIdx);
      const onResolved = fillOn(column, resolvedIdx);
      if (onOpen <= LEAK_MAX_OPEN_FILL && onResolved >= LEAK_MIN_RESOLVED_FILL) {
        refused.push({
          column,
          reason: leakReason(
            column,
            `filled on ${Math.round(onResolved * 100)}% of resolved leads and ${Math.round(onOpen * 100)}% of open ones`
          ),
        });
        continue;
      }
    }

    const suggested = fill >= MIN_FILL && levels <= MAX_LEVELS;
    const shape = `${levels} distinct values across ${Math.round(fill * 100)}% of rows`;

    discovered.push({
      column,
      levels,
      fill,
      suggested,
      reason: suggested
        ? `${shape}, so it reads as a category worth testing`
        : levels > MAX_LEVELS
          ? `${shape} - more levels than usually price well, so it is off unless you say otherwise`
          : `${shape} - thinner than we would normally test, so it is off unless you say otherwise`,
    });
  }

  return { discovered, refused };
}

/**
 * The columns the engine will test, from all three readers.
 *
 * The assistant's candidates come first because they carry a claim to answer,
 * then the columns whose shape suggested them. The advertiser's own switches
 * win over both: they can be looking at a column they know matters that the
 * shape test passed over, or at one that reads as a category and means
 * nothing. A column named twice is one column.
 *
 * @param overrides Column to on/off. Absent leaves the reader's own answer.
 */
export function signalColumnsFor(
  intakeKeys: string[],
  discovered: DiscoveredSignal[],
  overrides: Record<string, boolean> = {},
  /**
   * Columns refused outright. The assistant can name one in a claim - "our
   * best leads are the ones we lost on price" names the lost reason - and
   * without this the claim would have put it straight into the model past
   * both the protected-characteristics rule and the leakage guard.
   */
  refused: string[] = []
): string[] {
  const out: string[] = [];
  const never = new Set(refused);
  const add = (c: string) => {
    if (never.has(c)) return;
    if (overrides[c] === false) return;
    if (!out.includes(c)) out.push(c);
  };

  for (const c of intakeKeys) add(c);
  for (const d of discovered) if (d.suggested) add(d.column);
  // Switched on by hand, whatever its shape said.
  for (const d of discovered) if (overrides[d.column] === true) add(d.column);

  return out;
}
