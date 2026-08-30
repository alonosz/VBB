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

  for (const r of [...rows].sort(
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
    ]);
  }

  return Papa.unparse({ fields: googleAdsFields(identifier), data });
}
