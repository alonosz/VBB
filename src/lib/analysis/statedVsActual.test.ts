import { describe, expect, it } from "vitest";
import { buildComparisons, extractStatedClaims } from "./statedVsActual";
import { cycleLengthStats } from "./cycleLength";
import { volumeCheck } from "./volume";
import { sourceEconomics } from "./sourceEconomics";
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

  it("flags a big gap between a stated 3-month cycle and a same-day reality", () => {
    const { comparisons } = buildComparisons(
      "Our sales cycle is about 3 months.",
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, NO_ICP
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
      sources, NO_ICP
    );
    expect(comparisons.find((c) => c.label === "Sales cycle")!.verdict).toBe("confirmed");
  });

  it("confirms named sources that really are the strongest", () => {
    const { comparisons } = buildComparisons(
      "Our best customers come from webinars.",
      cycleLengthStats(TWO_SOURCES),
      volumeCheck(TWO_SOURCES, NOW),
      sources, NO_ICP
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
      sources, NO_ICP
    );
    expect(comparisons.find((c) => c.label === "Best sources")!.verdict).toBe("gap");
  });

  it("omits comparisons it could not read rather than inventing them", () => {
    const { comparisons } = buildComparisons(
      "We just want better results from Google.",
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, NO_ICP
    );
    expect(comparisons).toHaveLength(0);
  });

  it("produces nothing at all when no context was given", () => {
    const { comparisons } = buildComparisons(
      undefined,
      cycleLengthStats(SAME_DAY_CLOSES),
      volumeCheck(SAME_DAY_CLOSES, NOW),
      sources, NO_ICP
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
      sources, icp
    );
    const fit = comparisons.find((c) => c.label === "Ideal customer fit")!;
    expect(fit.verdict).toBe("partial");
    expect(fit.note).toMatch(/hint rather than a finding/);
  });
});

describe("buildComparisons with assisted claims", () => {
  const sources = sourceEconomics(TWO_SOURCES);

  it("uses the assistant's reading of a cycle the regex could not parse", () => {
    // "a couple of quarters" has no digits for the regex to find.
    const text = "Deals usually take a couple of quarters.";
    const withoutHelp = buildComparisons(
      text, cycleLengthStats(LONG_CYCLE), volumeCheck(LONG_CYCLE, NOW), sources, NO_ICP
    );
    expect(withoutHelp.claims.cycleDaysMin).toBeNull();

    const withHelp = buildComparisons(
      text, cycleLengthStats(LONG_CYCLE), volumeCheck(LONG_CYCLE, NOW), sources, NO_ICP,
      { cycleDaysMin: 180, cycleDaysMax: 180 }
    );
    expect(withHelp.claims.cycleDaysMin).toBe(180);
    expect(withHelp.comparisons.find((c) => c.label === "Sales cycle")).toBeDefined();
  });

  it("keeps the regex reading for any claim the assistant did not make", () => {
    const { claims } = buildComparisons(
      "Sales cycle is about 2-3 months and we get 90 leads a month.",
      cycleLengthStats(LONG_CYCLE), volumeCheck(LONG_CYCLE, NOW), sources, NO_ICP,
      { cycleDaysMin: 45, cycleDaysMax: 60 }
    );
    expect(claims.cycleDaysMin).toBe(45);
    expect(claims.leadsPerMonthMin).toBe(90);
  });

  it("drops a named source that is not in the data", () => {
    const { claims } = buildComparisons(
      "We do well from trade shows.",
      cycleLengthStats(TWO_SOURCES), volumeCheck(TWO_SOURCES, NOW), sources, NO_ICP,
      { namedSources: ["Trade Shows"] }
    );
    expect(claims.namedSources).toEqual([]);
  });

  it("matches a named source back to the label used in the file", () => {
    const { claims } = buildComparisons(
      "Webinars are our best channel.",
      cycleLengthStats(TWO_SOURCES), volumeCheck(TWO_SOURCES, NOW), sources, NO_ICP,
      { namedSources: ["webinar"] }
    );
    expect(claims.namedSources).toEqual(["Webinar"]);
  });
});

describe("claims typed straight in", () => {
  const sources = sourceEconomics(TWO_SOURCES);
  const base = [
    "Sales cycle is about 2-3 months.",
    cycleLengthStats(LONG_CYCLE),
    volumeCheck(LONG_CYCLE, NOW),
    sources,
    NO_ICP,
  ] as const;

  it("an explicit cycle outranks both the assistant and the regex", () => {
    const { claims } = buildComparisons(
      ...base,
      { cycleDaysMin: 45, cycleDaysMax: 45 },
      { cycleDays: 120 }
    );
    expect(claims.cycleDaysMin).toBe(120);
    expect(claims.cycleDaysMax).toBe(120);
  });

  it("falls back to the parsed text when nothing was typed", () => {
    const { claims } = buildComparisons(...base, undefined, { cycleDays: null });
    expect(claims.cycleDaysMin).toBeCloseTo(60.9, 0);
  });

  it("ignores a nonsensical typed cycle rather than pricing on it", () => {
    const { claims } = buildComparisons(...base, undefined, { cycleDays: -5 });
    expect(claims.cycleDaysMin).toBeCloseTo(60.9, 0);
  });

  it("reports how much won revenue came from the size they named", () => {
    const { comparisons } = buildComparisons(...base, undefined, {
      sizeLabel: "100–1,000",
      sizeFit: {
        available: true, wonRevenueShare: 0.82, wonInside: 30,
        wonOutside: 5, engineBands: ["201–1,000"], lowConfidence: false,
      },
    });
    const size = comparisons.find((c) => c.label === "Customer size")!;
    expect(size.verdict).toBe("confirmed");
    expect(size.stated).toBe("100–1,000 people");
    expect(size.actual).toBe("82%");
  });

  it("calls it a gap when most revenue came from outside the stated size", () => {
    const { comparisons } = buildComparisons(...base, undefined, {
      sizeLabel: "2–10",
      sizeFit: {
        available: true, wonRevenueShare: 0.15, wonInside: 2,
        wonOutside: 40, engineBands: ["1–49"], lowConfidence: false,
      },
    });
    expect(comparisons.find((c) => c.label === "Customer size")!.verdict).toBe("gap");
  });

  it("says nothing about size when no size was claimed", () => {
    const { comparisons } = buildComparisons(...base, undefined, {});
    expect(comparisons.find((c) => c.label === "Customer size")).toBeUndefined();
  });
});
