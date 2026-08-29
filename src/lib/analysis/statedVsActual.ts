import type { CycleLengthStats, IcpFitResult, SourceEconomics, VolumeCheck } from "./types";
import { round } from "./helpers";
import type { SizeFitResult } from "./statedProfile";

/**
 * Compares what the user said about their business against what their data
 * shows. The gap is the hook - someone who believes their cycle is three
 * months and closes half their deals in nine days is bidding on the wrong
 * assumption entirely.
 *
 * Extraction is deliberately loose keyword matching. When a claim can't be
 * read out of the text, that comparison is simply omitted rather than guessed.
 */

export type ComparisonVerdict = "gap" | "confirmed" | "partial";

export interface Comparison {
  label: string;
  stated: string;
  actual: string;
  verdict: ComparisonVerdict;
  note: string;
}

export interface StatedClaims {
  cycleDaysMin: number | null;
  cycleDaysMax: number | null;
  leadsPerMonthMin: number | null;
  leadsPerMonthMax: number | null;
  namedSources: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim().toLowerCase();
  if (NUMBER_WORDS[cleaned] !== undefined) return NUMBER_WORDS[cleaned];
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1,
  week: 7, weeks: 7,
  month: 30.44, months: 30.44,
  quarter: 91.3, quarters: 91.3,
  year: 365, years: 365,
};

const NUM = "(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";

/** Pulls a stated sales-cycle range, normalized to days. */
function extractCycle(text: string): { min: number | null; max: number | null } {
  const unitAlt = Object.keys(UNIT_DAYS).join("|");

  // "2-3 months", "two to three weeks"
  const range = new RegExp(`${NUM}\\s*(?:-|–|-|to)\\s*${NUM}\\s*(${unitAlt})\\b`, "i");
  const m = text.match(range);
  if (m) {
    const lo = toNumber(m[1]);
    const hi = toNumber(m[2]);
    const unit = UNIT_DAYS[m[3].toLowerCase()];
    if (lo !== null && hi !== null) {
      return { min: round(lo * unit, 1), max: round(hi * unit, 1) };
    }
  }

  // "about 3 months", "roughly 45 days"
  const single = new RegExp(`${NUM}\\s*(${unitAlt})\\b`, "i");
  const s = text.match(single);
  if (s) {
    const n = toNumber(s[1]);
    const unit = UNIT_DAYS[s[2].toLowerCase()];
    if (n !== null) {
      const days = round(n * unit, 1);
      return { min: days, max: days };
    }
  }

  return { min: null, max: null };
}

/** Pulls a stated monthly lead volume. */
function extractVolume(text: string): { min: number | null; max: number | null } {
  // Require the sentence to be about leads, so "200-1000 employees" is never
  // read as lead volume.
  const range = text.match(
    new RegExp(
      `${NUM}\\s*(?:-|–|-|to)\\s*${NUM}\\s*(?:new\\s+)?(?:leads|inquiries|enquiries|contacts|forms?)\\b`,
      "i"
    )
  );
  if (range) {
    const lo = toNumber(range[1]);
    const hi = toNumber(range[2]);
    if (lo !== null && hi !== null) return { min: lo, max: hi };
  }

  const single = text.match(
    new RegExp(`${NUM}\\s*(?:new\\s+)?(?:leads|inquiries|enquiries|contacts|forms?)\\b`, "i")
  );
  if (single) {
    const n = toNumber(single[1]);
    if (n !== null) return { min: n, max: n };
  }

  return { min: null, max: null };
}

/** Finds source names from the data that the user named in their text. */
function extractNamedSources(text: string, knownSources: string[]): string[] {
  const lower = text.toLowerCase();
  return knownSources.filter((s) => {
    const name = s.toLowerCase();
    if (lower.includes(name)) return true;
    // "referrals" should match a "Referral" source.
    const singular = name.replace(/s$/, "");
    return singular.length > 3 && lower.includes(singular);
  });
}

export function extractStatedClaims(
  text: string | undefined,
  knownSources: string[]
): StatedClaims {
  if (!text?.trim()) {
    return {
      cycleDaysMin: null, cycleDaysMax: null,
      leadsPerMonthMin: null, leadsPerMonthMax: null,
      namedSources: [],
    };
  }
  const cycle = extractCycle(text);
  const volume = extractVolume(text);
  return {
    cycleDaysMin: cycle.min,
    cycleDaysMax: cycle.max,
    leadsPerMonthMin: volume.min,
    leadsPerMonthMax: volume.max,
    namedSources: extractNamedSources(text, knownSources),
  };
}

/**
 * The assistant reads the sentence; the regex reads the digits. Where the
 * assistant produced a claim we use it, because it understood the sentence.
 * Where it produced nothing we keep the regex, so the comparison still runs
 * when the call did not.
 */
function mergeClaims(
  regex: StatedClaims,
  assisted: Partial<StatedClaims> | undefined,
  knownSources: string[]
): StatedClaims {
  if (!assisted) return regex;

  const cycleFromAssistant = assisted.cycleDaysMin != null;
  const volumeFromAssistant = assisted.leadsPerMonthMin != null;

  // Source names have to exist in the data to be comparable against it.
  const assistedSources = (assisted.namedSources ?? [])
    .map((claimed) =>
      knownSources.find((s) => s.toLowerCase() === claimed.toLowerCase()) ??
      knownSources.find((s) => s.toLowerCase().includes(claimed.toLowerCase().replace(/s$/, "")))
    )
    .filter((s): s is string => !!s);

  return {
    cycleDaysMin: cycleFromAssistant ? assisted.cycleDaysMin! : regex.cycleDaysMin,
    cycleDaysMax: cycleFromAssistant
      ? assisted.cycleDaysMax ?? assisted.cycleDaysMin!
      : regex.cycleDaysMax,
    leadsPerMonthMin: volumeFromAssistant ? assisted.leadsPerMonthMin! : regex.leadsPerMonthMin,
    leadsPerMonthMax: volumeFromAssistant
      ? assisted.leadsPerMonthMax ?? assisted.leadsPerMonthMin!
      : regex.leadsPerMonthMax,
    namedSources: assistedSources.length > 0 ? [...new Set(assistedSources)] : regex.namedSources,
  };
}

function formatDayRange(min: number, max: number): string {
  const fmt = (d: number) =>
    d >= 60 ? `${Math.round(d / 30.44)} months` : d >= 14 ? `${Math.round(d / 7)} weeks` : `${Math.round(d)} days`;
  return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`.replace(/ (months|weeks|days)–/, "–");
}

/**
 * Builds the comparison rows. Only claims we could actually read are included,
 * so a vague description produces a short honest list rather than a padded one.
 */
export function buildComparisons(
  businessContext: string | undefined,
  cycle: CycleLengthStats,
  volume: VolumeCheck,
  sources: SourceEconomics[],
  icp: IcpFitResult,
  /**
   * Claims read out of the intake text by the assistant. They replace the
   * regex reading field by field - never partially, so a stated cycle always
   * comes from one reader or the other, not a blend of the two.
   */
  assisted?: Partial<StatedClaims>,
  /**
   * Claims typed straight into a field. They outrank both the assistant's
   * reading and the regex, because they are not a reading of anything - the
   * advertiser said them on purpose.
   */
  explicit?: { cycleDays?: number | null; sizeLabel?: string; sizeFit?: SizeFitResult }
): { claims: StatedClaims; comparisons: Comparison[] } {
  const knownSources = sources.map((s) => s.source);
  const claims = mergeClaims(
    extractStatedClaims(businessContext, knownSources),
    assisted,
    knownSources
  );
  if (typeof explicit?.cycleDays === "number" && explicit.cycleDays > 0) {
    claims.cycleDaysMin = explicit.cycleDays;
    claims.cycleDaysMax = explicit.cycleDays;
  }
  const comparisons: Comparison[] = [];

  // --- Sales cycle ---
  if (claims.cycleDaysMin !== null && cycle.medianDays !== null) {
    const statedMid = (claims.cycleDaysMin + (claims.cycleDaysMax ?? claims.cycleDaysMin)) / 2;
    const actual = cycle.medianDays;
    const ratio = statedMid > 0 ? actual / statedMid : 1;
    const isGap = ratio < 0.5 || ratio > 2;

    comparisons.push({
      label: "Sales cycle",
      stated: formatDayRange(claims.cycleDaysMin, claims.cycleDaysMax ?? claims.cycleDaysMin),
      actual: `${actual} days`,
      verdict: isGap ? "gap" : "confirmed",
      note: isGap
        ? actual < statedMid
          ? `Half your won deals close inside ${actual} days. The long ones you remember are likely your biggest accounts - they're the exception, not the pattern.`
          : `Deals are taking roughly ${Math.round(ratio)}× longer than you described, which changes whether real outcomes arrive in time to bid on.`
        : "Your read on this matches the data.",
    });
  }

  // --- Lead volume ---
  if (claims.leadsPerMonthMin !== null) {
    const lo = claims.leadsPerMonthMin;
    const hi = claims.leadsPerMonthMax ?? lo;
    const actual = volume.leadsPerMonth;
    const withinRange = actual >= lo * 0.7 && actual <= hi * 1.3;

    comparisons.push({
      label: "Lead volume",
      stated: lo === hi ? `${lo}/mo` : `${lo}–${hi}/mo`,
      actual: `${actual}/mo`,
      verdict: withinRange ? "confirmed" : "gap",
      note: withinRange
        ? volume.leadVolumeSufficient
          ? "Comfortably above the volume floor needed for reliable value-based bidding."
          : "Matches what you said, but it's below the volume Smart Bidding needs to learn from value signals."
        : actual < lo
        ? "Fewer leads in this export than you described - check whether the file covers every source."
        : "More leads in this export than you described.",
    });
  }

  // --- Best sources ---
  if (claims.namedSources.length > 0 && sources.length > 0) {
    const ranked = [...sources]
      .filter((s) => s.closeRate !== null && s.medianWonAmount !== null)
      .sort(
        (a, b) =>
          (b.closeRate! * b.medianWonAmount!) - (a.closeRate! * a.medianWonAmount!)
      );
    // Top half, but never the whole list - with two sources, naming the
    // weaker one has to read as a gap, not a confirmation.
    const topCount = Math.min(Math.ceil(ranked.length / 2), Math.max(1, ranked.length - 1));
    const topHalf = ranked.slice(0, topCount);
    const topNames = new Set(topHalf.map((s) => s.source));
    const hits = claims.namedSources.filter((s) => topNames.has(s));
    const positions = claims.namedSources.map(
      (s) => ranked.findIndex((r) => r.source === s) + 1
    );

    const allTop = hits.length === claims.namedSources.length;
    comparisons.push({
      label: "Best sources",
      stated: claims.namedSources.join(" & "),
      actual: positions.every((p) => p > 0)
        ? positions.map((p) => `#${p}`).join(" & ")
        : "not in this file",
      verdict: allTop ? "confirmed" : hits.length > 0 ? "partial" : "gap",
      note: allTop
        ? "They rank at the top on expected value per lead. Your instinct here is right."
        : hits.length > 0
        ? "Partly right - one of the sources you named is not among your strongest by expected value."
        : "The sources you named aren't your strongest by expected value per lead.",
    });
  }

  // --- ICP fit ---
  if (icp.available && icp.wonRevenueShareMatching !== null) {
    const pct = Math.round(icp.wonRevenueShareMatching * 100);
    const strong = pct >= 70;
    comparisons.push({
      label: "Ideal customer fit",
      stated: describeIcp(icp),
      actual: `${pct}%`,
      verdict: strong ? "confirmed" : "partial",
      note:
        (strong
          ? `${pct}% of won revenue comes from the profile you described.`
          : `Only ${pct}% of won revenue matches that profile - the rest came from customers you aren't deliberately bidding for.`) +
        (icp.lowConfidence
          ? " Based on a small number of deals, so treat it as a hint rather than a finding."
          : ""),
    });
  }

  // --- Customer size ---
  const fit = explicit?.sizeFit;
  if (fit?.available && fit.wonRevenueShare !== null && explicit?.sizeLabel) {
    const pct = Math.round(fit.wonRevenueShare * 100);
    const strong = pct >= 70;
    comparisons.push({
      label: "Customer size",
      stated: `${explicit.sizeLabel} people`,
      actual: `${pct}%`,
      verdict: strong ? "confirmed" : pct >= 40 ? "partial" : "gap",
      note:
        (strong
          ? `${pct}% of your won revenue came from companies that size. You are bidding for the right ones.`
          : `Only ${pct}% of your won revenue came from companies that size - the rest came from customers outside the range you named.`) +
        (fit.lowConfidence
          ? " Based on few deals carrying a headcount, so treat it as a hint."
          : ""),
    });
  }

  return { claims, comparisons };
}

function describeIcp(icp: IcpFitResult): string {
  const t = icp.traits;
  if (!t) return "your stated profile";
  const bits: string[] = [];
  if (t.employeeMin !== null) {
    bits.push(t.employeeMax !== null ? `${t.employeeMin}–${t.employeeMax} emp` : `${t.employeeMin}+ emp`);
  }
  if (t.industries.length > 0) bits.push(t.industries[0]);
  if (t.titles.length > 0) bits.push(t.titles[0]);
  return bits.join(", ") || "your stated profile";
}
