import Papa from "papaparse";
import type { CsvData } from "./types";

export const MAX_CSV_ROWS = 50000;
export const MAX_CSV_BYTES = 25 * 1024 * 1024; // 25 MB

export class CsvParseError extends Error {}

export function parseCsvFile(file: File): Promise<CsvData> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CSV_BYTES) {
      reject(
        new CsvParseError(
          `File is too large (${(file.size / 1024 / 1024).toFixed(
            1
          )} MB). Please upload a CSV under ${MAX_CSV_BYTES / 1024 / 1024} MB.`
        )
      );
      return;
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        if (headers.length === 0) {
          reject(
            new CsvParseError(
              "No columns were found in this file. Make sure the first row contains column headers."
            )
          );
          return;
        }

        const rows = results.data.filter((row) =>
          Object.values(row).some((v) => (v ?? "").toString().trim() !== "")
        );

        if (rows.length === 0) {
          reject(
            new CsvParseError(
              "No data rows were found below the header row."
            )
          );
          return;
        }

        if (rows.length > MAX_CSV_ROWS) {
          reject(
            new CsvParseError(
              `This file has ${rows.length.toLocaleString()} rows, which is over the ${MAX_CSV_ROWS.toLocaleString()}-row limit for this MVP. Please upload a smaller sample.`
            )
          );
          return;
        }

        resolve({
          fileName: file.name,
          headers,
          rows,
          rowCount: rows.length,
        });
      },
      error: (err) => {
        reject(new CsvParseError(`Could not parse this CSV: ${err.message}`));
      },
    });
  });
}

export function toCsvString(
  headers: string[],
  rows: (string | number)[][]
): string {
  return Papa.unparse({ fields: headers, data: rows });
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeEmailForHashing(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Formats a date-ish string into Google Ads' required "yyyy-MM-dd HH:mm:ss+00:00" form. */
export function formatGoogleAdsTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}-${mo}-${day} ${h}:${mi}:${s}+00:00`;
}
