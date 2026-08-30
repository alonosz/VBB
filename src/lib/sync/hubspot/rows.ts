import type { MappedDeal } from "@/lib/analysis/types";

/**
 * HubSpot deals, in the shape the upload flow already understands.
 *
 * The obvious design was to hand the analysis `MappedDeal[]` straight from
 * HubSpot and skip the mapping screen. It is the wrong one, for two reasons.
 *
 * The first is the mapping screen itself. Principle 3 says every rule the
 * product applies has to be visible and arguable, and "which column is the
 * close date" is the most consequential rule in the whole flow. A CSV user
 * gets to see and correct it. A HubSpot user skipping that screen would be
 * trusting a mapping nobody showed them, and when a portal has renamed a
 * property or keeps the click ID somewhere unusual, they would have no way of
 * finding out. Pre-filling that screen correctly is a better answer than
 * removing it.
 *
 * The second is that every screen after step 2 would need to learn about a
 * second kind of input. `CLAUDE.md` is explicit that both sources land on the
 * same `MappedDeal[]` and nothing downstream knows which was used. Rows in,
 * rows out, one path.
 *
 * So this converts back: the pull produces `MappedDeal[]`, which carries the
 * currency conversion and click-ID discovery that only the HubSpot reader
 * knows how to do, and then this flattens it to rows with headers chosen to
 * be unambiguous to `detectColumns()`. The round trip is deliberate, and the
 * test asserts it is lossless on every field the model reads.
 */

/**
 * Headers chosen to match `detectColumns()` on the strongest hint available,
 * so the mapping opens filled in and correct rather than merely plausible.
 * Changing one of these means re-running the round-trip test.
 */
export const HUBSPOT_HEADERS = {
  id: "Record ID",
  createdAt: "Create Date",
  closedAt: "Close Date",
  outcome: "Outcome",
  amount: "Deal Amount",
  stage: "Deal Stage",
  source: "Lead Source",
  email: "Email",
  clickId: "Google Click ID",
  employeeCount: "Employee Count",
  industry: "Industry",
  contactTitle: "Job Title",
} as const;

export interface RowSet {
  headers: string[];
  rows: Record<string, string>[];
}

/** ISO date, no time. What every CRM export writes and what the parser wants. */
function day(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : String(value);
}

/**
 * Deliberately the words a CRM writes rather than our internal enum.
 *
 * `open` becomes an empty cell for the same reason a CRM leaves it empty: the
 * deal has not resolved, and writing "open" into an outcome column invites the
 * detector to treat it as a third result.
 */
function outcome(value: MappedDeal["outcome"]): string {
  if (value === "won") return "Won";
  if (value === "lost") return "Lost";
  return "";
}

/**
 * Flattens deals to rows, including only the columns that carry something.
 *
 * A column of entirely empty cells is worse than an absent one: the mapping
 * screen offers it, the detector may match it, and the report then reports a
 * field as present at a 0% fill rate. A portal that does not capture the click
 * ID should see no click ID column at all, and be told so.
 */
export function dealsToRows(deals: MappedDeal[]): RowSet {
  const present = new Set<string>();
  const rows: Record<string, string>[] = [];

  for (const deal of deals) {
    const row: Record<string, string> = {
      [HUBSPOT_HEADERS.id]: deal.id,
      [HUBSPOT_HEADERS.createdAt]: day(deal.createdAt),
      [HUBSPOT_HEADERS.closedAt]: day(deal.closedAt),
      [HUBSPOT_HEADERS.outcome]: outcome(deal.outcome),
      [HUBSPOT_HEADERS.amount]: num(deal.amount),
      [HUBSPOT_HEADERS.stage]: text(deal.stage),
      [HUBSPOT_HEADERS.source]: text(deal.source),
      [HUBSPOT_HEADERS.email]: text(deal.email),
      [HUBSPOT_HEADERS.clickId]: text(deal.clickId),
      [HUBSPOT_HEADERS.employeeCount]: num(deal.employeeCount),
      [HUBSPOT_HEADERS.industry]: text(deal.industry),
      [HUBSPOT_HEADERS.contactTitle]: text(deal.contactTitle),
    };

    for (const [header, value] of Object.entries(row)) {
      if (value !== "") present.add(header);
    }
    rows.push(row);
  }

  // Record ID is always kept, even for an empty pull: a row set with no
  // columns at all reads downstream as a broken file rather than an empty one.
  present.add(HUBSPOT_HEADERS.id);

  const headers = Object.values(HUBSPOT_HEADERS).filter((h) => present.has(h));
  return {
    headers,
    rows: rows.map((row) => {
      const trimmed: Record<string, string> = {};
      for (const header of headers) trimmed[header] = row[header];
      return trimmed;
    }),
  };
}
