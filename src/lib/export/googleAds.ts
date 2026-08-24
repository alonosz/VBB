import Papa from "papaparse";
import type { CohortValue } from "@/lib/analysis/types";

/**
 * Google Ads Click Conversion Import.
 *
 * The column names below are Google's, not ours — they must match the spec
 * exactly or the import is rejected. Conversion Time must carry an explicit
 * offset; a bare local timestamp is the most common reason an upload fails.
 */

export const GOOGLE_ADS_COLUMNS = [
  "Google Click ID",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
] as const;

export const GOOGLE_ADS_EMAIL_COLUMNS = [
  "Email",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
] as const;

/** Formats a date as Google's required "yyyy-MM-dd HH:mm:ss+00:00". */
export function formatConversionTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+00:00`
  );
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** SHA-256 hex, as Google requires for hashed email uploads. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface CohortExportOptions {
  cohorts: CohortValue[];
  conversionName: string;
  currencyCode: string;
  /** Timestamp written on every row; defaults to now. */
  conversionTime?: Date;
}

/**
 * Exports the cohort value table as a Google-Ads-shaped CSV.
 *
 * This is a template, not a live upload: the identifier column is left blank
 * for the user to fill from their own lead export, because we have cohort
 * values here, not individual leads. Cohorts with no expected value are
 * omitted rather than exported as zero — sending 0 tells Smart Bidding the
 * lead was worthless, which is a different claim from "we don't know yet".
 */
export function buildCohortValueCsv(opts: CohortExportOptions): string {
  const { cohorts, conversionName, currencyCode } = opts;
  const time = formatConversionTime(opts.conversionTime ?? new Date());

  const rows = cohorts
    .filter((c) => c.expectedValue !== null && c.expectedValue > 0)
    .map((c) => [
      "", // Google Click ID — filled per lead from the user's own export
      conversionName,
      time,
      c.expectedValue!.toFixed(2),
      currencyCode,
      c.key,
      String(c.sampleSize),
      c.closeRate !== null ? (c.closeRate * 100).toFixed(1) + "%" : "",
    ]);

  return Papa.unparse({
    // The five Google columns first, then reference columns the user strips
    // before uploading. Google ignores trailing columns it doesn't recognize,
    // but they make the file readable while it's being filled in.
    fields: [...GOOGLE_ADS_COLUMNS, "Segment (reference)", "Sample size", "Close rate"],
    data: rows,
  });
}

export interface LeadRow {
  clickId: string | null;
  email: string | null;
  createdAt: Date | null;
  value: number;
}

export interface LeadExportResult {
  csv: string;
  included: number;
  skipped: number;
  skippedReason: string | null;
}

/**
 * Exports per-lead conversions. Rows without a usable identifier or timestamp
 * are skipped and counted — never emitted with a placeholder.
 */
export async function buildLeadConversionCsv(
  leads: LeadRow[],
  opts: {
    conversionName: string;
    currencyCode: string;
    identifier: "clickId" | "email";
  }
): Promise<LeadExportResult> {
  const rows: string[][] = [];
  let skipped = 0;

  for (const lead of leads) {
    if (!lead.createdAt) {
      skipped++;
      continue;
    }

    let id: string | null = null;
    if (opts.identifier === "clickId") {
      id = lead.clickId?.trim() || null;
    } else if (lead.email?.trim()) {
      id = await sha256Hex(normalizeEmail(lead.email));
    }

    if (!id) {
      skipped++;
      continue;
    }

    rows.push([
      id,
      opts.conversionName,
      formatConversionTime(lead.createdAt),
      lead.value.toFixed(2),
      opts.currencyCode,
    ]);
  }

  const fields =
    opts.identifier === "clickId"
      ? [...GOOGLE_ADS_COLUMNS]
      : [...GOOGLE_ADS_EMAIL_COLUMNS];

  return {
    csv: Papa.unparse({ fields, data: rows }),
    included: rows.length,
    skipped,
    skippedReason:
      skipped > 0
        ? `${skipped.toLocaleString()} lead${skipped === 1 ? "" : "s"} had no ${
            opts.identifier === "clickId" ? "click ID" : "email address"
          } or no create date`
        : null,
  };
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
