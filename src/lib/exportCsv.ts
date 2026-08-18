import type { ExportConfig, MatchConfig, ScoredRow } from "./types";
import {
  formatGoogleAdsTime,
  normalizeEmailForHashing,
  sha256Hex,
  toCsvString,
} from "./csv";

export function buildGenericCsv(headers: string[], scored: ScoredRow[]): string {
  const outHeaders = [...headers, "Score", "Tier"];
  const rows = scored.map((s) => [
    ...headers.map((h) => s.row[h] ?? ""),
    String(s.score),
    s.tier,
  ]);
  return toCsvString(outHeaders, rows);
}

export interface GoogleAdsExportResult {
  csv: string;
  includedCount: number;
  skippedCount: number;
}

export async function buildGoogleAdsCsv(
  scored: ScoredRow[],
  matchConfig: MatchConfig,
  exportConfig: ExportConfig
): Promise<GoogleAdsExportResult> {
  const matchHeader = matchConfig.type === "gclid" ? "Google Click ID" : "Email";
  const headers = [
    matchHeader,
    "Conversion Name",
    "Conversion Time",
    "Conversion Value",
    "Conversion Currency",
  ];

  const rows: (string | number)[][] = [];
  let skipped = 0;

  for (const s of scored) {
    if (s.excluded || !matchConfig.column) {
      skipped += 1;
      continue;
    }
    const rawMatch = (s.row[matchConfig.column] ?? "").toString().trim();
    const conversionTime = exportConfig.conversionTimeColumn
      ? formatGoogleAdsTime(s.row[exportConfig.conversionTimeColumn])
      : null;

    if (!rawMatch || !conversionTime) {
      skipped += 1;
      continue;
    }

    const matchValue =
      matchConfig.type === "gclid"
        ? rawMatch
        : await sha256Hex(normalizeEmailForHashing(rawMatch));

    const value = Math.round((s.score / 100) * exportConfig.maxConversionValue * 100) / 100;

    rows.push([
      matchValue,
      exportConfig.conversionName,
      conversionTime,
      value,
      exportConfig.currencyCode,
    ]);
  }

  return {
    csv: toCsvString(headers, rows),
    includedCount: rows.length,
    skippedCount: skipped,
  };
}
