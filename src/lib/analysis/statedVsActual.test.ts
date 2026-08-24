import { describe, expect, it } from "vitest";
import { buildComparisons, extractStatedClaims } from "./statedVsActual";
import { cycleLengthStats } from "./cycleLength";
import { volumeCheck } from "./volume";
import { sourceEconomics } from "./sourceEconomics";
import { cohortValueTable } from "./cohortValues";
import { SAME_DAY_CLOSES, LONG_CYCLE, TWO_SOURCES, NOW } from "@/lib/fixtures/edgeCases";
import type { IcpFitResult } from "./types";

const NO_ICP: IcpFitResult = {
  available: false, traits: null, matching: null, nonMatching: null,
  lowConfidence: false, wonRevenueShareMatching: null,
};

const SOURCES = ["Webinar", "Paid Social", "Referral"];

describe("extractStatedClaims", () => {
  it("reads a month range as days", () => {
    const c = extractStatedClaims("Sales cycle is about 2-3 months.", SOURCES);
    expect(c.cycleDaysMin).toBeCloseTo(60.9, 0);
    expect(c.cycleDaysMax).toBeCloseTo(91.3, 0);
  });

  it("reads written-out numbers and weeks", () => {
    const c = extractStatedClaims("Usually two to three weeks to close.", SOURCES);
    expect(c.cycleDaysMin).toBe(14);
    expect(c.cycleDaysMax).toBe(21);
  });

  it("reads a single stated cycle", () => {
    const c = extractStatedClaims("Takes roughly 45 days.", SOURCES);
    expect(c.cycleDaysMin).toBe(45);
    expect(c.cycleDaysMax).toBe(45);
  });

  it("reads a monthly lead volume range", () => {
    const c = extractStatedClaims("We get 150-200 leads a month.", SOURCES);
    expect(c.leadsPerMonthMin).toBe(150);
    expect(c.leadsPerMonthMax).toBe(200);
  });

  it("does not mistake an employee range for lead volume", () => {
    const c = extractStatedClaims(
      "We sell to companies with 200-1000 employees.",
      SOURCES
    );
    expect(c.leadsPerMonthMin).toBeNull();
  });

  it("matches a plural mention to a singular source name", () => {
    const c = extractStatedClaims("Our best come from referrals and webinars.", SOURCES);
    expect(c.namedSources).toContain("Referral");
    expect(c.namedSources).toContain("Webinar");
    expect(c.namedSources).not.toContain("Paid Social");
  });

  it("returns empty claims for vague or missing text", () => {
    const c = extractStatedClaims("We want more leads please", SOURCES);
    expect(c.cycleDaysMin).toBeNull();
    expect(extractStatedClaims(undefined, SOURCES).namedSources).toEqual([]);
  });
});

describe("buildComparisons", () => {
  const sources = sourceEconomics(TWO_SOURCES);
  const cohorts = cohortValueTable(TWO_SOURCES, null);

  it("flags a big gap between a stated 3-month cycle and a same-day reality", () => {
    const { comparisons } = buildComparisons(
      "Our sales cycle is about 3 months.",
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, cohorts, NO_ICP
    );
    const cycle = comparisons.find((c) => c.label === "Sales cycle")!;
    expect(cycle.verdict).toBe("gap");
    expect(cycle.actual).toBe("0 days");
    expect(cycle.note).toMatch(/exception, not the pattern/);
  });

  it("confirms a stated cycle that matches reality", () => {
    const { comparisons } = buildComparisons(
      "Deals take about 3 months to close.",
      cycleLengthStats(LONG_CYCLE),
      volumeCheck(LONG_CYCLE, NOW),
      sources, cohorts, NO_ICP
    );
    expect(comparisons.find((c) => c.label === "Sales cycle")!.verdict).toBe("confirmed");
  });

  it("confirms named sources that really are the strongest", () => {
    const { comparisons } = buildComparisons(
      "Our best customers come from webinars.",
      cycleLengthStats(TWO_SOURCES),
      volumeCheck(TWO_SOURCES, NOW),
      sources, cohorts, NO_ICP
    );
    const best = comparisons.find((c) => c.label === "Best sources")!;
    expect(best.verdict).toBe("confirmed");
    expect(best.actual).toBe("#1");
  });

  it("flags named sources that are actually the weakest", () => {
    const { comparisons } = buildComparisons(
      "Paid social is where our best leads come from.",
      cycleLengthStats(TWO_SOURCES),
      volumeCheck(TWO_SOURCES, NOW),
      sources, cohorts, NO_ICP
    );
    expect(comparisons.find((c) => c.label === "Best sources")!.verdict).toBe("gap");
  });

  it("omits comparisons it could not read rather than inventing them", () => {
    const { comparisons } = buildComparisons(
      "We just want better results from Google.",
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, cohorts, NO_ICP
    );
    expect(comparisons).toHaveLength(0);
  });

  it("produces nothing at all when no context was given", () => {
    const { comparisons } = buildComparisons(
      undefined,
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, cohorts, NO_ICP
    );
    expect(comparisons).toEqual([]);
  });

  it("hedges the ICP comparison when the sample is small", () => {
    const icp: IcpFitResult = {
      available: true,
      traits: { employeeMin: 200, employeeMax: 1000, industries: ["manufacturing"], titles: [] },
      matching: null, nonMatching: null,
      lowConfidence: true,
      wonRevenueShareMatching: 0.42,
    };
    const { comparisons } = buildComparisons(
      "We sell to manufacturing companies with 200-1000 employees.",
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, cohorts, icp
    );
    const fit = comparisons.find((c) => c.label === "Ideal customer fit")!;
    expect(fit.verdict).toBe("partial");
    expect(fit.note).toMatch(/hint rather than a finding/);
  });
});
