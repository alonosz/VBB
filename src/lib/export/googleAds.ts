import Papa from "papaparse";
import type { ValuedLead } from "@/lib/analysis/valueModel";

/**
 * Google Ads Click Conversion Import.
 *
 * The column names below are Google's, not ours - they must match the spec
 * exactly or the import is rejected. Conversion Time must carry an explicit
 * offset; a bare local timestamp is the most common reason an upload fails.
 */

/**
 * Which identifiers a file carries.
 *
 * Not a preference and not a question anybody is asked: it is a fact about the
 * rows. A file whose leads all carry a click ID is a plain click import. A file
 * with no click IDs at all has to go the enhanced conversions route. A file
 * with some of each carries both columns, which is what Google itself
 * recommends - the click ID matches the exact click it recorded, and the email
 * catches the leads whose click ID never survived iOS, an ad blocker or a
 * change of device.
 */
export type IdentifierSet = "clickId" | "email" | "both";

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

/**
 * Both, in Google's order of precedence.
 *
 * A row may fill either or both. Where both are present Google uses the click
 * ID and ignores the email, so nothing is double counted; where the click ID is
 * blank the email is what the lead is matched on.
 */
export const GOOGLE_ADS_BOTH_COLUMNS = [
  "Google Click ID",
  "Email",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
] as const;

/** What this feed matches on, for a person reading a screen. */
export function identifierLabel(identifier: IdentifierSet): string {
  if (identifier === "clickId") return "Ad click ID";
  if (identifier === "email") return "Hashed email";
  return "Click ID and hashed email";
}

/** The header row for a file carrying this identifier set. */
export function googleAdsFields(identifier: IdentifierSet): string[] {
  if (identifier === "clickId") return [...GOOGLE_ADS_COLUMNS];
  if (identifier === "email") return [...GOOGLE_ADS_EMAIL_COLUMNS];
  return [...GOOGLE_ADS_BOTH_COLUMNS];
}

/**
 * The leading cells of one row, matching `googleAdsFields` exactly.
 *
 * Null means this lead cannot go in this file at all. Keeping the header and
 * the cells in one place is the point: they drifting apart produces a file
 * whose columns do not line up with its values, which Google accepts and
 * misreads rather than rejecting.
 */
export function identifierCells(
  identifier: IdentifierSet,
  ids: { clickId?: string | null; hashedEmail?: string | null }
): string[] | null {
  const clickId = ids.clickId?.trim() || "";
  const hashedEmail = ids.hashedEmail?.trim() || "";
  if (identifier === "clickId") return clickId ? [clickId] : null;
  if (identifier === "email") return hashedEmail ? [hashedEmail] : null;
  return clickId || hashedEmail ? [clickId, hashedEmail] : null;
}

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
  identifier: IdentifierSet;
}

export interface ModelExportResult {
  csv: string;
  included: number;
  skipped: number;
  skippedReason: string | null;
}

/** What a lead needed and did not have, in the advertiser's words. */
function missingIdentifier(identifier: IdentifierSet): string {
  if (identifier === "clickId") return "no click ID";
  if (identifier === "email") return "no email address";
  return "neither a click ID nor an email address";
}

/**
 * Exports one row per lead, priced by the value model.
 *
 * This is the whole point of the product: an individual conversion carrying
 * what that specific lead was worth. Leads without a usable identifier or a
 * create date are skipped and counted - never emitted with a placeholder, and
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

    const hashedEmail = deal.email?.trim()
      ? await sha256Hex(normalizeEmail(deal.email))
      : null;
    const cells = identifierCells(opts.identifier, {
      clickId: deal.clickId,
      hashedEmail,
    });

    if (!cells) {
      skipped++;
      continue;
    }

    rows.push([
      ...cells,
      opts.conversionName,
      formatConversionTime(deal.createdAt),
      value.toFixed(2),
      opts.currencyCode,
    ]);
  }

  return {
    csv: Papa.unparse({ fields: googleAdsFields(opts.identifier), data: rows }),
    included: rows.length,
    skipped,
    skippedReason:
      skipped > 0
        ? `${skipped.toLocaleString()} lead${skipped === 1 ? "" : "s"} had ${missingIdentifier(
            opts.identifier
          )}, no create date, or no value the model could price`
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
