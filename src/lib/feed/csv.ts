import Papa from "papaparse";
import {
  GOOGLE_ADS_COLUMNS,
  GOOGLE_ADS_EMAIL_COLUMNS,
  formatConversionTime,
} from "@/lib/export/googleAds";
import type { FeedIdentifier, FeedRow } from "./types";

/**
 * The file Google fetches.
 *
 * Same format as the manual download, because it is the same import — the only
 * difference is who does the fetching. Column names are Google's and must match
 * its template exactly or the whole file is rejected.
 */
export function buildFeedCsv(
  rows: FeedRow[],
  identifier: FeedIdentifier,
  conversionName: string
): string {
  const fields =
    identifier === "clickId" ? [...GOOGLE_ADS_COLUMNS] : [...GOOGLE_ADS_EMAIL_COLUMNS];

  const data = rows
    .filter((r) => (identifier === "clickId" ? r.clickId : r.hashedEmail))
    .sort((a, b) => a.conversionTime.getTime() - b.conversionTime.getTime())
    .map((r) => [
      (identifier === "clickId" ? r.clickId : r.hashedEmail)!,
      conversionName,
      formatConversionTime(r.conversionTime),
      r.value.toFixed(2),
      r.currencyCode,
    ]);

  return Papa.unparse({ fields, data });
}
