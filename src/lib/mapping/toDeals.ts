import type { DealOutcome, ExcludedRow, MappedDeal } from "@/lib/analysis/types";
import type { DetectedField, FieldKey } from "./detect";

export interface CurrencyPolicy {
  /** The single currency every amount is reported in. */
  reportingCurrency: string;
  /** Manual rates keyed by source currency code, e.g. { GBP: 1.27 }. */
  rates: Record<string, number>;
  /** When true, rows in another currency with no rate are dropped. */
  excludeUnconvertible: boolean;
}

export interface MappingResult {
  deals: MappedDeal[];
  excluded: ExcludedRow[];
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? null : new Date(t);
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  // Strip currency symbols and thousands separators, keep sign and decimal.
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const WON_PATTERNS = /\b(won|closed won|complete|completed|customer|success|sold)\b/i;
const LOST_PATTERNS = /\b(lost|closed lost|dead|disqualified|rejected|churn)\b/i;

/**
 * Derives outcome from an explicit outcome column when present, otherwise
 * from the stage name. Anything unrecognized is "open" rather than a guess in
 * either direction — miscounting a lost deal as won would inflate every close
 * rate in the report.
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
 * Converts an amount into the reporting currency. Returns undefined when the
 * row's currency has no rate — the caller decides whether that excludes the
 * row, and we never fall back to treating it as 1:1.
 */
function convertAmount(
  amount: number,
  rowCurrency: string | null,
  policy: CurrencyPolicy | null
): number | undefined {
  if (!policy || !rowCurrency) return amount;
  const code = rowCurrency.trim().toUpperCase();
  if (!code || code === policy.reportingCurrency.toUpperCase()) return amount;
  const rate = policy.rates[code];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return undefined;
  return Math.round(amount * rate * 100) / 100;
}

export interface ToDealsOptions {
  rows: Record<string, string>[];
  fields: DetectedField[];
  currency?: CurrencyPolicy | null;
  /** Drop exact duplicate rows, keeping the first of each. */
  dropDuplicates?: boolean;
}

/**
 * Turns confirmed column mappings into the normalized shape the analysis
 * engine consumes. Every dropped row is recorded with a reason — nothing
 * disappears silently, and nothing is invented to fill a gap.
 */
export function rowsToDeals(opts: ToDealsOptions): MappingResult {
  const { rows, fields, currency = null, dropDuplicates = true } = opts;

  const col = (key: FieldKey): string | null =>
    fields.find((f) => f.key === key)?.column ?? null;

  const cCreated = col("createdAt");
  const cClosed = col("closedAt");
  const cOutcome = col("outcome");
  const cAmount = col("amount");
  const cCurrency = col("currency");
  const cStage = col("stage");
  const cSource = col("source");
  const cEmail = col("email");
  const cClick = col("clickId");
  const cEmployees = col("employeeCount");
  const cIndustry = col("industry");
  const cTitle = col("contactTitle");

  const deals: MappedDeal[] = [];
  const excluded: ExcludedRow[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const id = `row-${index + 1}`;

    if (dropDuplicates) {
      const sig = JSON.stringify(row);
      if (seen.has(sig)) {
        excluded.push({ id, reason: "Exact duplicate of an earlier row" });
        return;
      }
      seen.add(sig);
    }

    const createdAt = cCreated ? parseDate(row[cCreated]) : null;
    if (cCreated && !createdAt) {
      excluded.push({
        id,
        reason: (row[cCreated] ?? "").trim()
          ? `Create date "${row[cCreated]}" could not be read as a date`
          : "Missing create date",
      });
      return;
    }

    let amount = cAmount ? parseAmount(row[cAmount]) : null;

    // Currency conversion happens before anything reads the amount, so no
    // downstream calculation can mix units.
    if (amount !== null && cCurrency) {
      const converted = convertAmount(amount, row[cCurrency] ?? null, currency);
      if (converted === undefined) {
        if (currency?.excludeUnconvertible) {
          excluded.push({
            id,
            reason: `Amount is in ${(row[cCurrency] ?? "another currency").trim()} with no conversion rate set`,
          });
          return;
        }
        amount = null;
      } else {
        amount = converted;
      }
    }

    const employeeRaw = cEmployees ? parseAmount(row[cEmployees]) : null;

    deals.push({
      id,
      createdAt,
      closedAt: cClosed ? parseDate(row[cClosed]) : null,
      outcome: deriveOutcome(
        cOutcome ? row[cOutcome] : undefined,
        cStage ? row[cStage] : undefined
      ),
      amount,
      stage: cStage ? (row[cStage] ?? "").trim() || null : null,
      source: cSource ? (row[cSource] ?? "").trim() || null : null,
      email: cEmail ? (row[cEmail] ?? "").trim() || null : null,
      clickId: cClick ? (row[cClick] ?? "").trim() || null : null,
      employeeCount: employeeRaw,
      industry: cIndustry ? (row[cIndustry] ?? "").trim() || null : null,
      contactTitle: cTitle ? (row[cTitle] ?? "").trim() || null : null,
    });
  });

  return { deals, excluded };
}
