import type {
  DomainValueDisparity,
  IcpFitResult,
  IcpTraits,
  MappedDeal,
  SegmentStats,
} from "./types";
import { classifyDomain, groupBy, round, summarizeSegment, sum } from "./helpers";

/** Segments smaller than this get a low-confidence caveat, never suppression. */
export const LOW_CONFIDENCE_THRESHOLD = 20;

const EMPLOYEE_BANDS: { label: string; min: number; max: number | null }[] = [
  { label: "1–49",     min: 0,    max: 49 },
  { label: "50–199",   min: 50,   max: 199 },
  { label: "200–999",  min: 200,  max: 999 },
  { label: "1000+",    min: 1000, max: null },
];

function bandFor(count: number): string {
  const band = EMPLOYEE_BANDS.find(
    (b) => count >= b.min && (b.max === null || count <= b.max)
  );
  return band?.label ?? "unknown";
}

/**
 * (h) Close rate and median value by email-domain type, plus firmographic
 * cuts when the export carries them.
 *
 * This is the empirical backing for Day-0 scoring: if corporate-domain leads
 * close at 3× the rate of free-webmail leads, that difference is knowable at
 * lead creation and can be priced immediately — no model required.
 */
export function domainValueDisparity(deals: MappedDeal[]): DomainValueDisparity {
  const withEmail = deals.filter((d) => classifyDomain(d.email) !== "unknown");

  if (withEmail.length === 0) {
    return { available: false, byDomainType: [] };
  }

  const byType = [...groupBy(withEmail, (d) => classifyDomain(d.email))]
    .map(([type, group]) => summarizeSegment(type, group))
    .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));

  const result: DomainValueDisparity = { available: true, byDomainType: byType };

  const withEmployees = deals.filter(
    (d) => typeof d.employeeCount === "number" && Number.isFinite(d.employeeCount)
  );
  if (withEmployees.length > 0) {
    result.byEmployeeBand = [...groupBy(withEmployees, (d) => bandFor(d.employeeCount!))]
      .map(([label, group]) => summarizeSegment(label, group))
      .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));
  }

  const withIndustry = deals.filter((d) => !!d.industry?.trim());
  if (withIndustry.length > 0) {
    result.byIndustry = [...groupBy(withIndustry, (d) => d.industry!.trim())]
      .map(([label, group]) => summarizeSegment(label, group))
      .sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));
  }

  return result;
}

// ---------------------------------------------------------------------------
// ICP extraction — deliberately loose keyword matching, no NLP
// ---------------------------------------------------------------------------

/**
 * Industry stems rather than exact words, so "manufacturers",
 * "manufacturing" and "manufacture" all resolve to the same canonical label.
 * Matched at a word boundary against the stem.
 */
const INDUSTRY_STEMS: { stem: string; label: string }[] = [
  { stem: "manufactur",  label: "manufacturing" },
  { stem: "logistic",    label: "logistics" },
  { stem: "construction", label: "construction" },
  { stem: "retail",      label: "retail" },
  { stem: "healthcare",  label: "healthcare" },
  { stem: "health care", label: "healthcare" },
  { stem: "saas",        label: "saas" },
  { stem: "software",    label: "software" },
  { stem: "insur",       label: "insurance" },
  { stem: "legal",       label: "legal" },
  { stem: "law firm",    label: "legal" },
  { stem: "education",   label: "education" },
  { stem: "real estate", label: "real estate" },
  { stem: "financ",      label: "finance" },
  { stem: "hospitality", label: "hospitality" },
  { stem: "automotive",  label: "automotive" },
  { stem: "energy",      label: "energy" },
  { stem: "solar",       label: "solar" },
];

/**
 * Titles resolve to a canonical singular label, so "ops directors" in the
 * intake text still matches a "Operations Director" row in the CRM.
 *
 * Bare generic tokens ("lead") are deliberately excluded — "we want more leads
 * please" is not a statement about buyer seniority, and matching it would
 * silently narrow the ICP comparison to nothing.
 */
const TITLE_STEMS: { stem: string; label: string }[] = [
  { stem: "ceo",         label: "ceo" },
  { stem: "cfo",         label: "cfo" },
  { stem: "coo",         label: "coo" },
  { stem: "cto",         label: "cto" },
  { stem: "founder",     label: "founder" },
  { stem: "owner",       label: "owner" },
  { stem: "president",   label: "president" },
  { stem: "vp",          label: "vp" },
  { stem: "vice president", label: "vice president" },
  { stem: "director",    label: "director" },
  { stem: "head of",     label: "head of" },
  { stem: "manager",     label: "manager" },
  { stem: "procurement", label: "procurement" },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match, so "lead" never matches inside "leads". */
function containsWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word)}\\b`, "i").test(haystack);
}

/** Word-boundary prefix match, so "manufactur" matches "manufacturers". */
function containsStem(haystack: string, stem: string): boolean {
  return new RegExp(`\\b${escapeRe(stem)}`, "i").test(haystack);
}

/**
 * Pulls rough ICP traits out of free-text intake. This is intentionally a
 * keyword scan, not a parser — the goal is a usable hint, and anything it
 * misses simply means the ICP check skips rather than guesses.
 */
export function extractIcpTraits(text: string | undefined): IcpTraits | null {
  if (!text || !text.trim()) return null;
  const lower = text.toLowerCase();

  // Employee range: "200-1000 employees", "200 to 1000 employees".
  let employeeMin: number | null = null;
  let employeeMax: number | null = null;
  const range = lower.match(/(\d[\d,]*)\s*(?:-|–|—|to)\s*(\d[\d,]*)\s*(?:\+)?\s*(?:employees|people|staff|headcount|emp\b)/);
  if (range) {
    employeeMin = Number(range[1].replace(/,/g, ""));
    employeeMax = Number(range[2].replace(/,/g, ""));
  } else {
    const over = lower.match(/(?:over|above|more than|\d*\s*)?(\d[\d,]*)\s*\+?\s*(?:employees|people|staff|headcount)/);
    if (over) employeeMin = Number(over[1].replace(/,/g, ""));
  }

  const industries = [
    ...new Set(
      INDUSTRY_STEMS.filter((s) => containsStem(lower, s.stem)).map((s) => s.label)
    ),
  ];
  const titles = [
    ...new Set(
      TITLE_STEMS.filter((t) =>
        // Short acronyms ("vp", "ceo") need a strict word match or they hit
        // inside unrelated words; longer titles use stem matching for plurals.
        t.stem.length <= 3 ? containsWord(lower, t.stem) : containsStem(lower, t.stem)
      ).map((t) => t.label)
    ),
  ];

  if (employeeMin === null && industries.length === 0 && titles.length === 0) {
    return null;
  }
  return { employeeMin, employeeMax, industries, titles };
}

function matchesIcp(deal: MappedDeal, traits: IcpTraits): boolean {
  // Every stated dimension we can check must hold. Dimensions the row can't
  // speak to are skipped rather than counted as failures.
  if (traits.employeeMin !== null && typeof deal.employeeCount === "number") {
    if (deal.employeeCount < traits.employeeMin) return false;
    if (traits.employeeMax !== null && deal.employeeCount > traits.employeeMax) return false;
  }
  if (traits.industries.length > 0 && deal.industry) {
    const industry = deal.industry.toLowerCase();
    if (!traits.industries.some((i) => industry.includes(i))) return false;
  }
  if (traits.titles.length > 0 && deal.contactTitle) {
    const title = deal.contactTitle.toLowerCase();
    if (!traits.titles.some((t) => title.includes(t))) return false;
  }
  return true;
}

/**
 * (i) Compares deals matching the stated ICP against those that don't.
 *
 * Skips silently unless the intake text yielded traits AND the export carries
 * a firmographic column those traits can actually be checked against.
 */
export function icpFitCheck(
  deals: MappedDeal[],
  businessContext: string | undefined
): IcpFitResult {
  const empty: IcpFitResult = {
    available: false,
    traits: null,
    matching: null,
    nonMatching: null,
    lowConfidence: false,
    wonRevenueShareMatching: null,
  };

  const traits = extractIcpTraits(businessContext);
  if (!traits) return empty;

  const hasFirmographics = deals.some(
    (d) =>
      typeof d.employeeCount === "number" ||
      !!d.industry?.trim() ||
      !!d.contactTitle?.trim()
  );
  if (!hasFirmographics) return empty;

  const matching: MappedDeal[] = [];
  const nonMatching: MappedDeal[] = [];
  for (const deal of deals) {
    (matchesIcp(deal, traits) ? matching : nonMatching).push(deal);
  }

  // A split where everything landed on one side tells the user nothing.
  if (matching.length === 0 || nonMatching.length === 0) return empty;

  const wonValue = (list: MappedDeal[]) =>
    sum(
      list
        .filter((d) => d.outcome === "won" && d.amount !== null)
        .map((d) => d.amount!)
    );
  const matchingWon = wonValue(matching);
  const totalWon = matchingWon + wonValue(nonMatching);

  return {
    available: true,
    traits,
    matching: summarizeSegment("ICP match", matching),
    nonMatching: summarizeSegment("Outside ICP", nonMatching),
    lowConfidence:
      matching.length < LOW_CONFIDENCE_THRESHOLD ||
      nonMatching.length < LOW_CONFIDENCE_THRESHOLD,
    wonRevenueShareMatching: totalWon > 0 ? round(matchingWon / totalWon, 4) : null,
  };
}

export type { SegmentStats };
