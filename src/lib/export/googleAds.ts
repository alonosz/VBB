import Papa from "papaparse";
import type { ValuedLead } from "@/lib/analysis/valueModel";

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

export interface ModelExportOptions {
  /** Every lead, already priced by the value model. */
  leads: ValuedLead[];
  conversionName: string;
  currencyCode: string;
  identifier: "clickId" | "email";
}

export interface ModelExportResult {
  csv: string;
  included: number;
  skipped: number;
  skippedReason: string | null;
}

/**
 * Exports one row per lead, priced by the value model.
 *
 * This is the whole point of the product: an individual conversion carrying
 * what that specific lead was worth. Leads without a usable identifier or a
 * create date are skipped and counted — never emitted with a placeholder, and
 * never emitted at zero, which would tell Google the lead was worthless rather
 * than unmeasurable.
 */
export async function buildValueModelCsv(
  opts: ModelExportOptions
): Promise<ModelExportResult> {
  const rows: string[][] = [];
  let skipped = 0;

  for (const lead of opts.leads) {
    const { deal, value } = lead;

    if (!deal.createdAt || value <= 0) {
      skipped++;
      continue;
    }

    let id: string | null = null;
    if (opts.identifier === "clickId") {
      id = deal.clickId?.trim() || null;
    } else if (deal.email?.trim()) {
      id = await sha256Hex(normalizeEmail(deal.email));
    }

    if (!id) {
      skipped++;
      continue;
    }

    rows.push([
      id,
      opts.conversionName,
      formatConversionTime(deal.createdAt),
      value.toFixed(2),
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
          }, no create date, or no value the model could price`
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
