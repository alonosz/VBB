import Papa from "papaparse";
import {
  formatConversionTime,
  googleAdsFields,
  identifierCells,
} from "@/lib/export/googleAds";
import type { FeedIdentifier, FeedRow } from "./types";

/**
 * The file Google fetches.
 *
 * Same format as the manual download, because it is the same import - the only
 * difference is who does the fetching. Column names are Google's and must match
 * its template exactly or the whole file is rejected.
 *
 * A row the feed's identifier set cannot express is left out rather than
 * emitted with a blank identifier. That only happens to a feed published under
 * one of the single-column sets; under `both` a stored row always has at least
 * one of the two, because nothing without one is storable.
 */
export function buildFeedCsv(
  rows: FeedRow[],
  identifier: FeedIdentifier,
  conversionName: string
): string {
  const data: string[][] = [];

  for (const r of [...collapse(rows).values()].sort(
    (a, b) => a.conversionTime.getTime() - b.conversionTime.getTime()
  )) {
    const cells = identifierCells(identifier, r);
    if (!cells) continue;
    data.push([
      ...cells,
      conversionName,
      formatConversionTime(r.conversionTime),
      r.value.toFixed(2),
      r.currencyCode,
      // Already the API's transaction id for the same lead, which is what lets
      // Google reconcile a file fetch and an API send instead of counting both.
      r.rowKey,
    ]);
  }

  return Papa.unparse({ fields: googleAdsFields(identifier), data });
}

/**
 * One line per lead, carrying the latest value the rules let through.
 *
 * A conversions file has no way to say "the value I gave you last week has
 * gone up". An adjustment used to go in as a second line under the same
 * Order ID, and Google ignores a second line under an Order ID it has
 * already imported, so the higher value never landed and the screen said it
 * had. Restating a value is a different import in Google Ads, with its own
 * file layout, and this file is not it.
 *
 * What the file can do is carry the right value from the start. A lead
 * whose value rose inside the rules before Google collected it is imported
 * once, at the higher value, on its original conversion time. One Google has
 * already collected keeps the value it first saw, and the rise is input for
 * the next refit, which is what the screen now says.
 */
function collapse(rows: FeedRow[]): Map<string, FeedRow> {
  const byLead = new Map<string, FeedRow>();
  for (const r of rows) {
    const seen = byLead.get(r.rowKey);
    if (!seen) {
      byLead.set(r.rowKey, r);
      continue;
    }
    // The adjustment's value on the conversion's own time and identifiers.
    if (r.kind === "adjustment" && seen.kind === "conversion") {
      byLead.set(r.rowKey, { ...seen, value: r.value });
    } else if (r.kind === "conversion" && seen.kind === "adjustment") {
      byLead.set(r.rowKey, { ...r, value: seen.value });
    }
  }
  return byLead;
}
