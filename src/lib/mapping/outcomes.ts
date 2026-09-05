import type { DealOutcome } from "@/lib/analysis/types";

/**
 * Which values in the file mean a sale, and which mean the lead is gone.
 *
 * Every close rate in the product rests on this reading, and until now it
 * was a fixed list of sales-pipeline words: won, closed won, customer, sold.
 * An insurance CRM says "Bound", a lender says "Funded", a school says
 * "Enrolled", a subscription business says "Converted" or "Paid". A file in
 * any of those words had every row read as "still open", the report found
 * nothing to price, and nothing on screen said why.
 *
 * Two things fix that. The built-in list knows the words that mean the same
 * thing in every vertical, and the mapping screen shows the reading of every
 * value in the deciding column so the advertiser can correct it. What they
 * set wins over the list, and only for the exact value they set it on.
 *
 * Deterministic, like the rest of mapping. Unrecognised is "open", never a
 * guess in either direction: a lost deal read as won inflates every close
 * rate in the report.
 */

/**
 * Words that mean the lead became a customer, in whatever vertical.
 *
 * Deliberately not here: "approved" (a loan is approved before it funds),
 * "signed" (an application is signed before a policy binds), "booked" (an
 * appointment is booked before anything is sold), "active" (an active lead
 * is an open one). Each names a step before the sale in at least one
 * vertical, and a step read as a sale is the error this file exists to
 * avoid. The advertiser can set any of them by hand.
 */
const WON_PATTERNS =
  /\b(won|closed won|complete|completed|customer|success|sold|purchased|bought|paid|converted|bound|enrolled|funded|subscribed)\b/i;

/**
 * Words that mean the lead is gone. Spam, junk and duplicates are here on
 * purpose: an ad click that produced one is a click that produced nothing,
 * and its value to bidding is zero rather than unknown.
 */
const LOST_PATTERNS =
  /\b(lost|closed lost|dead|disqualified|rejected|churn|churned|declined|cancelled|canceled|unqualified|not interested|no[ -]show|withdrawn|denied|spam|junk|duplicate)\b/i;

/** The advertiser's own reading of a value, keyed by `outcomeKey()`. */
export type OutcomeOverrides = Record<string, DealOutcome>;

/** One key per value however it is capitalised or padded in the file. */
export function outcomeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Derives outcome from an explicit outcome column when present, otherwise
 * from the stage name. Anything unrecognized is "open" rather than a guess in
 * either direction.
 */
export function deriveOutcome(
  outcomeRaw: string | undefined,
  stageRaw: string | undefined
): DealOutcome {
  for (const candidate of [outcomeRaw, stageRaw]) {
    if (!candidate?.trim()) continue;
    if (LOST_PATTERNS.test(candidate)) return "lost";
    if (WON_PATTERNS.test(candidate)) return "won";
  }
  return "open";
}

/**
 * The reading the engine uses: the advertiser's word on the exact value
 * first, the built-in list after. An override on the outcome value beats one
 * on the stage value, in the same order the built-in reading works.
 */
export function readOutcome(
  outcomeRaw: string | undefined,
  stageRaw: string | undefined,
  overrides: OutcomeOverrides = {}
): DealOutcome {
  for (const candidate of [outcomeRaw, stageRaw]) {
    if (!candidate?.trim()) continue;
    const set = overrides[outcomeKey(candidate)];
    if (set) return set;
  }
  return deriveOutcome(outcomeRaw, stageRaw);
}

export interface OutcomeValue {
  value: string;
  count: number;
  /** The reading in force. */
  read: DealOutcome;
  /** What the built-in list says, so a correction can be undone. */
  rule: DealOutcome;
  /** Whether the reading came from the built-in list or the advertiser. */
  by: "rule" | "you";
}

export interface OutcomeVocabulary {
  /** The column whose values decide the outcome. */
  column: string;
  values: OutcomeValue[];
  won: number;
  lost: number;
  open: number;
  /** Distinct values beyond what is listed; a sign this is not a status column. */
  more: number;
}

/** Values listed on the mapping screen. Past this it is not a status column. */
export const MAX_LISTED = 24;

/**
 * Every value in the deciding column with how it is read, most common
 * first, for the mapping screen to show and the advertiser to correct.
 *
 * The outcome column decides when it is mapped; the stage column otherwise.
 * Blank cells are not a value - they are the rows we know nothing about.
 */
export function outcomeVocabulary(
  rows: Record<string, string>[],
  outcomeColumn: string | null,
  stageColumn: string | null,
  overrides: OutcomeOverrides = {}
): OutcomeVocabulary | null {
  const column = outcomeColumn ?? stageColumn;
  if (!column) return null;

  const counts = new Map<string, { value: string; count: number }>();
  for (const row of rows) {
    const raw = (row[column] ?? "").trim();
    if (!raw) continue;
    const key = outcomeKey(raw);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { value: raw, count: 1 });
  }

  const all = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, { value, count }]) => {
      const set = overrides[key];
      const rule = outcomeColumn ? deriveOutcome(value, undefined) : deriveOutcome(undefined, value);
      return { value, count, read: set ?? rule, rule, by: set ? ("you" as const) : ("rule" as const) };
    });

  const values = all.slice(0, MAX_LISTED);
  const tally = (o: DealOutcome) => all.filter((v) => v.read === o).reduce((n, v) => n + v.count, 0);

  return {
    column,
    values,
    won: tally("won"),
    lost: tally("lost"),
    open: tally("open"),
    more: Math.max(0, all.length - MAX_LISTED),
  };
}
