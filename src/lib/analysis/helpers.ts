import type { DomainType, MappedDeal, SegmentStats } from "./types";

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Linear-interpolated quantile. Input need not be sorted. */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

/** Rounds to `dp` decimal places, avoiding float noise like 0.30000000000000004. */
export function round(value: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export const MS_PER_DAY = 86_400_000;

/** Whole-day difference. Negative when `to` precedes `from`. */
export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

export function monthsSpanned(dates: Date[]): number {
  if (dates.length === 0) return 0;
  const times = dates.map((d) => d.getTime());
  const spanDays = (Math.max(...times) - Math.min(...times)) / MS_PER_DAY;
  // A single day of data is still one month of observation, not zero.
  return Math.max(1, spanDays / 30.44);
}

// ---------------------------------------------------------------------------
// Email / identifier handling
// ---------------------------------------------------------------------------

/**
 * Free webmail providers, hardcoded on purpose - the spec forbids enrichment
 * APIs. This list only needs to cover the common cases; anything unrecognized
 * is treated as corporate, which is the conservative direction (it avoids
 * inflating the corporate-vs-free gap with misclassified rare providers).
 */
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
  "ymail.com", "rocketmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "live.com", "msn.com", "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "gmx.com", "gmx.de", "gmx.net", "mail.com",
  "zoho.com", "yandex.com", "yandex.ru", "mail.ru", "inbox.com", "fastmail.com",
  "hushmail.com", "tutanota.com", "web.de", "t-online.de", "orange.fr",
  "free.fr", "libero.it", "sapo.pt", "bigpond.com", "comcast.net",
  "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net", "cox.net",
  "btinternet.com", "sky.com", "virginmedia.com", "ntlworld.com", "qq.com",
  "163.com", "126.com", "naver.com", "hanmail.net", "daum.net", "rediffmail.com",
]);

// Deliberately permissive: we are classifying, not validating deliverability.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function isValidEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return EMAIL_RE.test(raw.trim());
}

export function emailDomain(raw: string | null | undefined): string | null {
  if (!isValidEmail(raw)) return null;
  const at = raw!.trim().toLowerCase().lastIndexOf("@");
  return raw!.trim().toLowerCase().slice(at + 1);
}

export function classifyDomain(raw: string | null | undefined): DomainType {
  const domain = emailDomain(raw);
  if (!domain) return "unknown";
  return FREE_EMAIL_DOMAINS.has(domain) ? "free" : "corporate";
}

/** A deal is joinable to an ad click if it has a click ID or a usable email. */
export function hasIdentifier(deal: MappedDeal): boolean {
  const clickId = deal.clickId?.trim();
  if (clickId) return true;
  return isValidEmail(deal.email);
}

// ---------------------------------------------------------------------------
// Segment aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregates a set of deals into the stats every segment view shares.
 * `expectedValue` is intentionally uncapped here - capping is applied later,
 * only where a value is actually emitted for bidding.
 */
export function summarizeSegment(segment: string, deals: MappedDeal[]): SegmentStats {
  const won = deals.filter((d) => d.outcome === "won");
  const lost = deals.filter((d) => d.outcome === "lost");
  const closed = won.length + lost.length;
  const closeRate = closed > 0 ? won.length / closed : null;

  const wonAmounts = won
    .map((d) => d.amount)
    .filter((a): a is number => a !== null);
  const medianWon = median(wonAmounts);

  return {
    segment,
    total: deals.length,
    won: won.length,
    lost: lost.length,
    closeRate,
    medianWonAmount: medianWon,
    expectedValue:
      closeRate !== null && medianWon !== null
        ? round(closeRate * medianWon)
        : null,
  };
}

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Won deals carrying a usable amount - the basis of every value figure. */
export function wonWithAmount(deals: MappedDeal[]): MappedDeal[] {
  return deals.filter((d) => d.outcome === "won" && d.amount !== null);
}
