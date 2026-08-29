import { describe, expect, it } from "vitest";
import {
  cycleLengthStats,
  stageTrustCheck,
  earlyGateDetection,
  sourceEconomics,
  shadowRoas,
  matchRateReadiness,
  valueSpreadAndCaps,
  applyCap,
  volumeCheck,
  domainValueDisparity,
  icpFitCheck,
  extractIcpTraits,
  determineVerdict,
  runDiagnostic,
  valueAllLeads,
} from "./index";
import type { DealOutcome } from "./types";
import {
  EMPTY,
  BACKFILLED_STAGES,
  NO_STAGE_DATA,
  SAME_DAY_CLOSES,
  OUTLIER_AMONG_SMALL,
  LOW_MATCH_RATE,
  ZERO_CLOSE_RATE,
  MISSING_AMOUNTS,
  LONG_CYCLE,
  TWO_SOURCES,
  DOMAIN_SPLIT,
  NOW,
} from "@/lib/fixtures/edgeCases";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";

// ---------------------------------------------------------------------------
// (a) cycleLengthStats
// ---------------------------------------------------------------------------

describe("cycleLengthStats", () => {
  it("returns empty stats without throwing on no input", () => {
    const r = cycleLengthStats(EMPTY);
    expect(r.sampleSize).toBe(0);
    expect(r.medianDays).toBeNull();
    expect(r.classification).toBeNull();
    expect(r.histogram).toHaveLength(6);
  });

  it("handles same-day closes as a zero-day cycle, not a missing one", () => {
    const r = cycleLengthStats(SAME_DAY_CLOSES);
    expect(r.sampleSize).toBe(10);
    expect(r.medianDays).toBe(0);
    expect(r.classification).toBe("FAST");
    expect(r.histogram[0].count).toBe(10);
  });

  it("classifies a 95-day median as LONG", () => {
    const r = cycleLengthStats(LONG_CYCLE);
    expect(r.medianDays).toBe(95);
    expect(r.classification).toBe("LONG");
    expect(r.histogram.at(-1)!.count).toBe(40);
  });

  it("ignores lost deals when measuring the cycle", () => {
    const r = cycleLengthStats(ZERO_CLOSE_RATE);
    expect(r.sampleSize).toBe(0);
  });

  it("puts boundary values in the expected buckets", () => {
    const r = cycleLengthStats(LONG_CYCLE);
    const total = r.histogram.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(r.sampleSize);
  });
});

// ---------------------------------------------------------------------------
// (b) stageTrustCheck
// ---------------------------------------------------------------------------

describe("stageTrustCheck", () => {
  it("reports unavailable rather than guessing when no stage data exists", () => {
    const r = stageTrustCheck(NO_STAGE_DATA);
    expect(r.available).toBe(false);
    expect(r.untrustedStages).toEqual([]);
  });

  it("flags a stage where most durations are seconds long", () => {
    const r = stageTrustCheck(BACKFILLED_STAGES);
    expect(r.available).toBe(true);
    expect(r.untrustedStages).toContain("Qualified");
    const qualified = r.findings.find((f) => f.stage === "Qualified")!;
    expect(qualified.subHourRate).toBeCloseTo(0.8, 5);
    expect(qualified.trusted).toBe(false);
  });

  it("leaves a stage with realistic durations trusted", () => {
    const r = stageTrustCheck(BACKFILLED_STAGES);
    const proposal = r.findings.find((f) => f.stage === "Proposal")!;
    expect(proposal.subHourRate).toBe(0);
    expect(proposal.trusted).toBe(true);
  });

  it("treats exactly 30% sub-hour as still trusted", () => {
    const deals = Array.from({ length: 10 }, (_, i) => ({
      ...NO_STAGE_DATA[0],
      id: `t-${i}`,
      stageDurations: { Demo: i < 3 ? 60 : 86_400 },
    }));
    const r = stageTrustCheck(deals);
    expect(r.findings[0].subHourRate).toBe(0.3);
    expect(r.untrustedStages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) earlyGateDetection
// ---------------------------------------------------------------------------

describe("earlyGateDetection", () => {
  it("says so honestly when there is no timing data", () => {
    const r = earlyGateDetection(NO_STAGE_DATA);
    expect(r.available).toBe(false);
    expect(r.recommended).toBeNull();
    expect(r.message).toMatch(/no stage-timing data/i);
  });

  it("excludes stages that stageTrustCheck flagged as backfilled", () => {
    const r = earlyGateDetection(BACKFILLED_STAGES, ["Qualified"]);
    expect(r.candidates.map((c) => c.stage)).not.toContain("Qualified");
  });

  it("recommends a stage that fires inside 7 days with enough volume", () => {
    const deals = Array.from({ length: 40 }, (_, i) => ({
      ...NO_STAGE_DATA[0],
      id: `g-${i}`,
      stageReachedAfterDays: { Qualified: i < 34 ? 2 : 20 },
    }));
    const r = earlyGateDetection(deals);
    expect(r.recommended?.stage).toBe("Qualified");
    expect(r.recommended!.withinWindowRate).toBeCloseTo(0.85, 5);
  });

  it("refuses to recommend a gate that mostly fires too late", () => {
    const deals = Array.from({ length: 40 }, (_, i) => ({
      ...NO_STAGE_DATA[0],
      id: `slow-${i}`,
      stageReachedAfterDays: { Qualified: i < 8 ? 3 : 30 },
    }));
    const r = earlyGateDetection(deals);
    expect(r.recommended).toBeNull();
    expect(r.message).toMatch(/no reliable early gate/i);
  });

  it("refuses to recommend on too small a sample even at a high rate", () => {
    const deals = Array.from({ length: 5 }, (_, i) => ({
      ...NO_STAGE_DATA[0],
      id: `few-${i}`,
      stageReachedAfterDays: { Qualified: 1 },
    }));
    const r = earlyGateDetection(deals);
    expect(r.candidates[0].withinWindowRate).toBe(1);
    expect(r.recommended).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) sourceEconomics + shadow ROAS
// ---------------------------------------------------------------------------

describe("sourceEconomics", () => {
  it("computes close rate from closed deals only, ignoring open ones", () => {
    const rows = sourceEconomics(TWO_SOURCES);
    const webinar = rows.find((r) => r.source === "Webinar")!;
    expect(webinar.won).toBe(5);
    expect(webinar.lost).toBe(5);
    expect(webinar.closeRate).toBe(0.5);
    expect(webinar.medianWonAmount).toBe(10_000);
    expect(webinar.totalWonValue).toBe(50_000);
  });

  it("returns a zero close rate rather than null when nothing has won", () => {
    const rows = sourceEconomics(ZERO_CLOSE_RATE);
    expect(rows[0].closeRate).toBe(0);
    expect(rows[0].medianWonAmount).toBeNull();
  });

  it("returns null close rate when nothing has closed at all", () => {
    const open = [{ ...TWO_SOURCES[0], id: "o1", outcome: "open" as const }];
    expect(sourceEconomics(open)[0].closeRate).toBeNull();
  });

  it("groups unattributed rows rather than dropping them", () => {
    const rows = sourceEconomics([{ ...TWO_SOURCES[0], id: "x", source: null }]);
    expect(rows[0].source).toMatch(/no source/i);
  });
});

describe("shadowRoas", () => {
  it("values every lead at 1 for Google and at real revenue for the business", () => {
    const rows = shadowRoas(TWO_SOURCES);
    const webinar = rows.find((r) => r.source === "Webinar")!;
    const social = rows.find((r) => r.source === "Paid Social")!;

    expect(webinar.googleSeesValue).toBe(10);
    expect(social.googleSeesValue).toBe(10);
    // Identical to Google, 25x apart in reality - the whole pitch.
    expect(webinar.actualValue).toBe(50_000);
    expect(social.actualValue).toBe(2_000);
    expect(webinar.actualValuePerLead).toBe(5_000);
    expect(social.actualValuePerLead).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// (e) matchRateReadiness
// ---------------------------------------------------------------------------

describe("matchRateReadiness", () => {
  it("flags a tracking gap at 12% coverage", () => {
    const r = matchRateReadiness(LOW_MATCH_RATE);
    expect(r.totalRows).toBe(50);
    expect(r.withAnyIdentifier).toBe(6);
    expect(r.overallRate).toBe(0.12);
    expect(r.isTrackingGap).toBe(true);
  });

  it("reports won-deal coverage separately from overall", () => {
    const r = matchRateReadiness(LOW_MATCH_RATE);
    expect(r.wonRows).toBe(10);
    expect(r.wonWithAnyIdentifier).toBe(6);
    expect(r.wonRate).toBe(0.6);
  });

  it("counts a click ID as an identifier even with no email", () => {
    const r = matchRateReadiness([
      { ...LOW_MATCH_RATE[0], id: "c1", email: null, clickId: "Cj0abc" },
    ]);
    expect(r.withAnyIdentifier).toBe(1);
    expect(r.withClickId).toBe(1);
  });

  it("does not count a malformed email as usable", () => {
    const r = matchRateReadiness([
      { ...LOW_MATCH_RATE[0], id: "b1", email: "not-an-email", clickId: null },
    ]);
    expect(r.withAnyIdentifier).toBe(0);
  });

  it("does not report a gap on empty input", () => {
    expect(matchRateReadiness(EMPTY).isTrackingGap).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f) valueSpreadAndCaps
// ---------------------------------------------------------------------------

describe("valueSpreadAndCaps", () => {
  it("caps at 3x median and clips exactly the outlier", () => {
    const r = valueSpreadAndCaps(OUTLIER_AMONG_SMALL);
    expect(r.sampleSize).toBe(21);
    expect(r.median).toBe(2000);
    expect(r.recommendedCap).toBe(6000);
    expect(r.dealsAboveCap).toBe(1);
    expect(r.max).toBe(200_000);
    expect(r.blindnessRatio).toBe(100);
  });

  it("excludes won deals with no amount from the distribution", () => {
    const r = valueSpreadAndCaps(MISSING_AMOUNTS);
    expect(r.sampleSize).toBe(4);
    expect(r.median).toBe(6000);
  });

  it("returns nulls rather than NaN when nothing has won", () => {
    const r = valueSpreadAndCaps(ZERO_CLOSE_RATE);
    expect(r.sampleSize).toBe(0);
    expect(r.median).toBeNull();
    expect(r.recommendedCap).toBeNull();
    expect(r.blindnessRatio).toBeNull();
  });

  it("avoids an infinite blindness ratio when a deal is worth zero", () => {
    const r = valueSpreadAndCaps([
      { ...OUTLIER_AMONG_SMALL[0], id: "z", amount: 0 },
      { ...OUTLIER_AMONG_SMALL[0], id: "y", amount: 5000 },
    ]);
    expect(r.blindnessRatio).toBeNull();
  });

  it("honors a custom cap multiple", () => {
    const r = valueSpreadAndCaps(OUTLIER_AMONG_SMALL, 5);
    expect(r.recommendedCap).toBe(10_000);
  });
});

describe("applyCap", () => {
  it("clips above the cap and passes through below it", () => {
    expect(applyCap(9000, 6000)).toBe(6000);
    expect(applyCap(3000, 6000)).toBe(3000);
    expect(applyCap(null, 6000)).toBeNull();
    expect(applyCap(9000, null)).toBe(9000);
  });
});

// ---------------------------------------------------------------------------
// (g) volumeCheck
// ---------------------------------------------------------------------------

describe("volumeCheck", () => {
  it("reports lead volume above won volume when most deals never close", () => {
    // 20 leads, only 5 of them won - the two numbers must not be conflated.
    const deals = [
      ...Array.from({ length: 5 }, (_, i) => ({
        ...LONG_CYCLE[0], id: `w-${i}`, outcome: "won" as const,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        ...LONG_CYCLE[0], id: `l-${i}`, outcome: "lost" as const,
      })),
    ];
    const r = volumeCheck(deals, NOW);
    expect(r.leadsPerMonth).toBeGreaterThan(r.wonDealsPerMonth);
    expect(r.wonDealsPerMonth).toBeGreaterThan(0);
  });

  it("warns when lead volume is under 30/month", () => {
    const r = volumeCheck(SAME_DAY_CLOSES, NOW);
    expect(r.leadVolumeSufficient).toBe(false);
    expect(r.warning).toMatch(/leads per month/i);
  });

  it("does not warn on the demo dataset's healthy volume", () => {
    const deals = generateDemoDeals();
    const r = volumeCheck(deals, new Date("2026-08-24T00:00:00Z"));
    expect(r.leadVolumeSufficient).toBe(true);
    expect(r.warning).toBeNull();
  });

  it("survives empty input", () => {
    const r = volumeCheck(EMPTY, NOW);
    expect(r.leadsPerMonth).toBe(0);
    expect(r.leadVolumeSufficient).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (h) domainValueDisparity
// ---------------------------------------------------------------------------

describe("domainValueDisparity", () => {
  it("shows corporate domains outperforming free webmail", () => {
    const r = domainValueDisparity(DOMAIN_SPLIT);
    expect(r.available).toBe(true);
    const corp = r.byDomainType.find((s) => s.segment === "corporate")!;
    const free = r.byDomainType.find((s) => s.segment === "free")!;
    expect(corp.closeRate).toBe(0.5);
    expect(free.closeRate).toBeCloseTo(0.1667, 3);
    expect(corp.expectedValue!).toBeGreaterThan(free.expectedValue!);
  });

  it("reports unavailable when no row has a usable email", () => {
    const r = domainValueDisparity(ZERO_CLOSE_RATE);
    expect(r.available).toBe(false);
  });

  it("adds firmographic cuts only when those columns exist", () => {
    expect(domainValueDisparity(DOMAIN_SPLIT).byEmployeeBand).toBeUndefined();
    const withFirmo = DOMAIN_SPLIT.map((d) => ({
      ...d,
      employeeCount: 300,
      industry: "Manufacturing",
    }));
    const r = domainValueDisparity(withFirmo);
    expect(r.byEmployeeBand?.[0].segment).toBe("200–999");
    expect(r.byIndustry?.[0].segment).toBe("Manufacturing");
  });
});

// ---------------------------------------------------------------------------
// (i) icpFitCheck
// ---------------------------------------------------------------------------

describe("extractIcpTraits", () => {
  it("pulls an employee range, industry and title out of free text", () => {
    const t = extractIcpTraits(
      "We sell to mid-market manufacturers, 200-1000 employees. Buyers are ops directors."
    )!;
    expect(t.employeeMin).toBe(200);
    expect(t.employeeMax).toBe(1000);
    expect(t.industries).toContain("manufacturing");
    expect(t.titles).toContain("director");
  });

  it("returns null when the text carries no usable traits", () => {
    expect(extractIcpTraits("We want more leads please")).toBeNull();
    expect(extractIcpTraits("")).toBeNull();
    expect(extractIcpTraits(undefined)).toBeNull();
  });
});

describe("icpFitCheck", () => {
  const CONTEXT = "We sell to manufacturing companies with 200-1000 employees.";

  it("skips silently when the export has no firmographic columns", () => {
    expect(icpFitCheck(DOMAIN_SPLIT, CONTEXT).available).toBe(false);
  });

  it("skips silently when intake text yields no traits", () => {
    const withFirmo = DOMAIN_SPLIT.map((d) => ({ ...d, employeeCount: 300 }));
    expect(icpFitCheck(withFirmo, "no useful detail here").available).toBe(false);
  });

  it("compares matching against non-matching deals", () => {
    const deals = [
      ...Array.from({ length: 25 }, (_, i) => ({
        ...DOMAIN_SPLIT[0],
        id: `in-${i}`,
        outcome: (i < 15 ? "won" : "lost") as DealOutcome,
        amount: i < 15 ? 10_000 : null,
        employeeCount: 500,
        industry: "Manufacturing",
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        ...DOMAIN_SPLIT[0],
        id: `out-${i}`,
        outcome: (i < 5 ? "won" : "lost") as DealOutcome,
        amount: i < 5 ? 3_000 : null,
        employeeCount: 20,
        industry: "Retail",
      })),
    ];
    const r = icpFitCheck(deals, CONTEXT);
    expect(r.available).toBe(true);
    expect(r.matching!.closeRate).toBe(0.6);
    expect(r.nonMatching!.closeRate).toBe(0.2);
    expect(r.lowConfidence).toBe(false);
    expect(r.wonRevenueShareMatching).toBeCloseTo(0.909, 2);
  });

  it("marks low confidence when a segment is under 20 deals", () => {
    const deals = [
      ...Array.from({ length: 5 }, (_, i) => ({
        ...DOMAIN_SPLIT[0], id: `s-${i}`, employeeCount: 500, industry: "Manufacturing",
      })),
      ...Array.from({ length: 30 }, (_, i) => ({
        ...DOMAIN_SPLIT[0], id: `l-${i}`, employeeCount: 10, industry: "Retail",
      })),
    ];
    expect(icpFitCheck(deals, CONTEXT).lowConfidence).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (k) verdict
// ---------------------------------------------------------------------------

describe("determineVerdict", () => {
  const okVolume = { monthsObserved: 6, leadsPerMonth: 200, wonDealsPerMonth: 30, leadVolumeSufficient: true, warning: null };
  const okMatch = { totalRows: 100, withClickId: 60, withValidEmail: 90, withAnyIdentifier: 90, overallRate: 0.9, wonRows: 20, wonWithAnyIdentifier: 18, wonRate: 0.9, isTrackingGap: false };
  const noGate = { available: false, candidates: [], recommended: null, message: "none" };

  it("returns MEASURED for a fast cycle with healthy inputs", () => {
    const v = determineVerdict(cycleLengthStats(SAME_DAY_CLOSES), okVolume, okMatch, noGate);
    expect(v.mode).toBe("MEASURED");
    expect(v.blockers).toEqual([]);
  });

  it("returns PREDICTED for a long cycle", () => {
    const v = determineVerdict(cycleLengthStats(LONG_CYCLE), okVolume, okMatch, noGate);
    expect(v.mode).toBe("PREDICTED");
    expect(v.reasoning).toMatch(/7-day window/);
  });

  it("mentions a detected early gate in PREDICTED reasoning", () => {
    const gate = {
      available: true,
      candidates: [{ stage: "Qualified", reachedCount: 40, withinWindowRate: 0.85 }],
      recommended: { stage: "Qualified", reachedCount: 40, withinWindowRate: 0.85 },
      message: null,
    };
    const v = determineVerdict(cycleLengthStats(LONG_CYCLE), okVolume, okMatch, gate);
    expect(v.reasoning).toMatch(/Qualified/);
    expect(v.reasoning).toMatch(/85%/);
  });

  it("returns NOT_YET with a named blocker on low volume", () => {
    const lowVol = { ...okVolume, leadsPerMonth: 8, leadVolumeSufficient: false, warning: "low" };
    const v = determineVerdict(cycleLengthStats(SAME_DAY_CLOSES), lowVol, okMatch, noGate);
    expect(v.mode).toBe("NOT_YET");
    expect(v.blockers[0]).toMatch(/8\/month/);
  });

  it("returns NOT_YET on a tracking gap", () => {
    const gap = { ...okMatch, overallRate: 0.12, isTrackingGap: true };
    const v = determineVerdict(cycleLengthStats(SAME_DAY_CLOSES), okVolume, gap, noGate);
    expect(v.mode).toBe("NOT_YET");
    expect(v.blockers.some((b) => /12%/.test(b))).toBe(true);
  });

  it("stacks multiple blockers rather than reporting only the first", () => {
    const lowVol = { ...okVolume, leadsPerMonth: 5, leadVolumeSufficient: false, warning: "low" };
    const gap = { ...okMatch, overallRate: 0.1, isTrackingGap: true };
    const v = determineVerdict(cycleLengthStats(EMPTY), lowVol, gap, noGate);
    expect(v.blockers.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator + demo dataset
// ---------------------------------------------------------------------------

describe("runDiagnostic", () => {
  it("produces a complete report on empty input without throwing", () => {
    const r = runDiagnostic({ deals: EMPTY, excluded: [], currencyCode: "USD", now: NOW });
    expect(r.rowsAnalyzed).toBe(0);
    expect(r.verdict.mode).toBe("NOT_YET");
    expect(r.valueModel.isFlat).toBe(true);
  });

  it("carries excluded rows through to the report", () => {
    const r = runDiagnostic({
      deals: SAME_DAY_CLOSES,
      excluded: [{ id: "x1", reason: "Missing deal amount" }],
      currencyCode: "USD",
      now: NOW,
    });
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0].reason).toBe("Missing deal amount");
  });

  it("runs end to end on the demo dataset with every section populated", () => {
    const deals = generateDemoDeals();
    const r = runDiagnostic({
      deals,
      excluded: [],
      currencyCode: "USD",
      businessContext: "We sell to manufacturing companies with 200-1000 employees. Buyers are ops directors.",
      now: new Date("2026-08-24T00:00:00Z"),
    });

    expect(r.rowsAnalyzed).toBe(501);
    expect(r.sources.length).toBe(6);
    expect(r.cycle.sampleSize).toBeGreaterThan(0);
    expect(r.shadowRoas.length).toBe(6);
    expect(r.valueModel.includedFactors.length).toBeGreaterThan(0);

    // The seeded outlier must trip the cap.
    expect(r.valueSpread.max).toBe(200_000);
    expect(r.valueSpread.dealsAboveCap).toBeGreaterThan(0);

    // ~15% click coverage plus emails on most rows keeps us above the gap line.
    expect(r.matchRate.overallRate).toBeGreaterThan(0.4);

    // ~30% backfilled rows should make at least one stage untrusted.
    expect(r.stageTrust.available).toBe(true);
    expect(r.stageTrust.untrustedStages.length).toBeGreaterThan(0);

    expect(r.icpFit.available).toBe(true);
    expect(["MEASURED", "PREDICTED"]).toContain(r.verdict.mode);
  });

  it("is deterministic across runs", () => {
    const a = generateDemoDeals();
    const b = generateDemoDeals();
    expect(a.length).toBe(b.length);
    expect(a[42].amount).toBe(b[42].amount);
    expect(a[42].source).toBe(b[42].source);
  });

  it("never emits a lead value above the cap", () => {
    const deals = generateDemoDeals();
    const r = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: new Date("2026-08-24T00:00:00Z") });
    const cap = r.valueSpread.recommendedCap!;
    for (const v of valueAllLeads(deals, r.valueModel)) {
      expect(v.value).toBeLessThanOrEqual(cap);
    }
  });

  it("builds a value model with no source-derived factor", () => {
    const deals = generateDemoDeals();
    const r = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: new Date("2026-08-24T00:00:00Z") });
    expect(r.valueModel.factors.map((f) => f.key)).not.toContain("source");
    expect(r.valueModel.fittedOn).toBeGreaterThan(0);
  });
});
