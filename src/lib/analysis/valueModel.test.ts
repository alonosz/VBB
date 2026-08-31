import { describe, expect, it } from "vitest";
import {
  buildValueModel,
  valueLead,
  valueAllLeads,
  bestCaseStack,
  clampStack,
  MIN_LEVEL_SAMPLE,
  MIN_LIFT,
  MAX_STACK_DEVIATION,
  withOverrides,
  effectiveMultiplier,
} from "./valueModel";
import { round } from "./helpers";
import { parseSeniority, employeeBand } from "./factors";
import type { MappedDeal } from "./types";

const DAY = new Date("2026-06-01T00:00:00Z");

function deal(p: Partial<MappedDeal> & { id: string }): MappedDeal {
  return {
    createdAt: DAY,
    closedAt: DAY,
    outcome: "lost",
    amount: null,
    stage: null,
    source: "Paid Search",
    email: null,
    clickId: null,
    ...p,
  };
}

/** Builds n deals where the first `wonCount` are won at `amount`. */
function cohort(
  prefix: string,
  n: number,
  wonCount: number,
  amount: number,
  attrs: Partial<MappedDeal>
): MappedDeal[] {
  return Array.from({ length: n }, (_, i) =>
    deal({
      id: `${prefix}-${i}`,
      outcome: i < wonCount ? "won" : "lost",
      amount: i < wonCount ? amount : null,
      ...attrs,
    })
  );
}

// ---------------------------------------------------------------------------
// Seniority + size parsing
// ---------------------------------------------------------------------------

describe("parseSeniority", () => {
  it("reads the common bands", () => {
    expect(parseSeniority("Chief Revenue Officer")).toBe("C-level");
    expect(parseSeniority("CEO")).toBe("C-level");
    expect(parseSeniority("Co-Founder")).toBe("C-level");
    expect(parseSeniority("VP of Operations")).toBe("VP");
    expect(parseSeniority("Head of Growth")).toBe("VP");
    expect(parseSeniority("Director of Platform")).toBe("Director");
    expect(parseSeniority("Plant Manager")).toBe("Manager");
    expect(parseSeniority("Procurement Lead")).toBe("Manager");
    expect(parseSeniority("Software Engineer")).toBe("IC");
  });

  it("resolves a mixed title to the more senior band", () => {
    expect(parseSeniority("VP of Sales, formerly Director")).toBe("VP");
  });

  it("returns null only when there is no title at all", () => {
    expect(parseSeniority("")).toBeNull();
    expect(parseSeniority(null)).toBeNull();
    expect(parseSeniority(undefined)).toBeNull();
  });

  it("does not mistake 'Owner' inside another word", () => {
    expect(parseSeniority("Downer Analyst")).toBe("IC");
  });
});

describe("employeeBand", () => {
  it("bands on the documented boundaries", () => {
    expect(employeeBand(1)).toBe("1–49");
    expect(employeeBand(49)).toBe("1–49");
    expect(employeeBand(50)).toBe("50–200");
    expect(employeeBand(200)).toBe("50–200");
    expect(employeeBand(201)).toBe("201–1,000");
    expect(employeeBand(1000)).toBe("201–1,000");
    expect(employeeBand(1001)).toBe("1,000+");
  });

  it("returns null for missing or nonsense counts", () => {
    expect(employeeBand(null)).toBeNull();
    expect(employeeBand(undefined)).toBeNull();
    expect(employeeBand(-5)).toBeNull();
    expect(employeeBand(NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source must never enter the model
// ---------------------------------------------------------------------------

describe("source exclusion", () => {
  it("never produces a factor keyed on deal source", () => {
    const deals = [
      ...cohort("a", 40, 20, 10_000, { source: "Webinar", email: "x@acme.com" }),
      ...cohort("b", 40, 4, 2_000, { source: "Paid Social", email: "y@gmail.com" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    expect(model.factors.map((f) => f.key)).not.toContain("source");
    expect(JSON.stringify(model)).not.toMatch(/Webinar|Paid Social/);
  });

  it("values two leads identically when only their source differs", () => {
    const deals = [
      ...cohort("corp", 40, 20, 10_000, { email: "a@acme.com" }),
      ...cohort("free", 40, 4, 2_000, { email: "b@gmail.com" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });

    const viaSearch = valueLead(deal({ id: "s", email: "new@acme.com", source: "Paid Search" }), model);
    const viaSocial = valueLead(deal({ id: "t", email: "new@acme.com", source: "Paid Social" }), model);
    expect(viaSearch.value).toBe(viaSocial.value);
  });
});

// ---------------------------------------------------------------------------
// Sample-size floor
// ---------------------------------------------------------------------------

describe("minimum sample size", () => {
  it("marks a level under the floor unusable", () => {
    const deals = [
      ...cohort("big", 40, 20, 10_000, { email: "a@acme.com" }),
      // Only 10 free-webmail deals - under the 25 floor.
      ...cohort("small", 10, 1, 1_000, { email: "b@gmail.com" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const domain = model.factors.find((f) => f.key === "domainType")!;
    const free = domain.levels.find((l) => l.level === "Free webmail")!;
    expect(free.sampleSize).toBe(10);
    expect(free.usable).toBe(false);
  });

  it("gives a lead in a thin level the baseline, not a thin-level multiplier", () => {
    const deals = [
      ...cohort("big", 40, 20, 10_000, { email: "a@acme.com" }),
      ...cohort("small", 10, 1, 1_000, { email: "b@gmail.com" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const thin = valueLead(deal({ id: "z", email: "new@gmail.com" }), model);
    // No step fired, so the value is the calibrated base.
    expect(thin.steps).toHaveLength(0);
    expect(thin.value).toBeCloseTo(
      Math.round(model.baseValue * model.calibrationFactor * 100) / 100,
      1
    );
  });

  it("drops a factor whose levels are all too thin", () => {
    const deals = [
      ...cohort("a", 20, 10, 5_000, { industry: "Mining" }),
      ...cohort("b", 20, 2, 5_000, { industry: "Retail" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const industry = model.factors.find((f) => f.key === "industry")!;
    expect(industry.included).toBe(false);
    expect(industry.droppedReason).toMatch(new RegExp(`${MIN_LEVEL_SAMPLE}\\+`));
  });
});

// ---------------------------------------------------------------------------
// Weak-factor dropping, two-sided
// ---------------------------------------------------------------------------

describe("weak factor dropping", () => {
  it("drops a factor whose strongest level barely moves value", () => {
    // Both levels close at nearly the same rate and value.
    const deals = [
      ...cohort("a", 40, 20, 10_000, { industry: "Manufacturing" }),
      ...cohort("b", 40, 19, 10_000, { industry: "Logistics" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const industry = model.factors.find((f) => f.key === "industry")!;
    expect(industry.strongestLift).toBeLessThan(MIN_LIFT);
    expect(industry.included).toBe(false);
    expect(industry.droppedReason).toMatch(/below our 1\.3x threshold/);
  });

  it("keeps a factor whose signal is strongly negative", () => {
    // Free webmail at ~0.2x is as informative as corporate at 2x, and a
    // one-sided test would have thrown it away.
    const deals = [
      ...cohort("corp", 40, 16, 10_000, { email: "a@acme.com" }),
      ...cohort("free", 40, 3, 6_000, { email: "b@gmail.com" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const domain = model.factors.find((f) => f.key === "domainType")!;
    const free = domain.levels.find((l) => l.level === "Free webmail")!;
    expect(free.lift).toBeLessThan(1);
    expect(domain.included).toBe(true);
  });

  it("drops a factor with only one usable level, having nothing to compare", () => {
    const deals = [
      ...cohort("only", 40, 20, 10_000, { industry: "Manufacturing" }),
      ...cohort("thin", 5, 1, 1_000, { industry: "Retail" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const industry = model.factors.find((f) => f.key === "industry")!;
    expect(industry.included).toBe(false);
    expect(industry.droppedReason).toMatch(/nothing to compare/);
  });
});

// ---------------------------------------------------------------------------
// Calibration - the guard against double-counting correlated factors
// ---------------------------------------------------------------------------

describe("calibration", () => {
  // Deliberately correlated: corporate email, large company and senior title
  // all describe the same "real business buyer". Multiplying their marginal
  // lifts would count that signal three times.
  const CORRELATED: MappedDeal[] = [
    ...cohort("good", 60, 30, 12_000, {
      email: "a@acme.com", employeeCount: 500, contactTitle: "Director of Ops",
    }),
    ...cohort("bad", 60, 3, 3_000, {
      email: "b@gmail.com", employeeCount: 10, contactTitle: "Student",
    }),
  ];

  it("keeps the portfolio average equal to the observed expected value", () => {
    const model = buildValueModel({ deals: CORRELATED, cap: null, currencyCode: "USD" });
    const valued = valueAllLeads(CORRELATED, model);
    const mean = valued.reduce((s, v) => s + v.value, 0) / valued.length;
    expect(mean).toBeCloseTo(model.baseValue, 0);
  });

  it("pulls the calibration factor below 1 when factors are correlated", () => {
    const model = buildValueModel({ deals: CORRELATED, cap: null, currencyCode: "USD" });
    expect(model.includedFactors.length).toBeGreaterThan(1);
    expect(model.calibrationFactor).toBeLessThan(1);
  });

  it("preserves the ordering between segments after calibration", () => {
    const model = buildValueModel({ deals: CORRELATED, cap: null, currencyCode: "USD" });
    const strong = valueLead(
      deal({ id: "s", email: "n@acme.com", employeeCount: 500, contactTitle: "Director of Ops" }),
      model
    );
    const weak = valueLead(
      deal({ id: "w", email: "n@gmail.com", employeeCount: 10, contactTitle: "Student" }),
      model
    );
    expect(strong.value).toBeGreaterThan(weak.value);
  });

  it("leaves calibration at 1 when the model is flat", () => {
    const flat = cohort("f", 40, 10, 5_000, {});
    const model = buildValueModel({ deals: flat, cap: null, currencyCode: "USD" });
    expect(model.isFlat).toBe(true);
    expect(model.calibrationFactor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stack deviation bound - the guard against compounding overlapping factors
// ---------------------------------------------------------------------------

describe("stack deviation bound", () => {
  it("clamps a product that runs away in either direction", () => {
    expect(clampStack(100)).toBe(MAX_STACK_DEVIATION);
    expect(clampStack(0.001)).toBeCloseTo(1 / MAX_STACK_DEVIATION, 6);
    expect(clampStack(3)).toBe(3);
    expect(clampStack(0.5)).toBe(0.5);
  });

  it("keeps the weakest lead from being priced at almost nothing", () => {
    // Four correlated negative signals; unbounded these compound to ~0.02x.
    const deals = [
      ...cohort("good", 60, 30, 12_000, {
        email: "a@acme.com", employeeCount: 800, industry: "Manufacturing", contactTitle: "Director",
      }),
      ...cohort("bad", 60, 3, 2_000, {
        email: "b@gmail.com", employeeCount: 8, industry: "Retail", contactTitle: "Student",
      }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const worst = valueLead(
      deal({
        id: "w", email: "n@gmail.com", employeeCount: 8,
        industry: "Retail", contactTitle: "Student",
      }),
      model
    );
    expect(worst.wasBounded).toBe(true);
    // Never further than the bound from base, after calibration.
    const floor = (model.baseValue / MAX_STACK_DEVIATION) * model.calibrationFactor;
    expect(worst.value).toBeGreaterThanOrEqual(round(floor, 2) - 0.02);
  });

  it("reports the unbounded product alongside the bounded one", () => {
    const deals = [
      ...cohort("good", 60, 30, 12_000, {
        email: "a@acme.com", employeeCount: 800, industry: "Manufacturing", contactTitle: "Director",
      }),
      ...cohort("bad", 60, 3, 2_000, {
        email: "b@gmail.com", employeeCount: 8, industry: "Retail", contactTitle: "Student",
      }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const worst = valueLead(
      deal({
        id: "w", email: "n@gmail.com", employeeCount: 8,
        industry: "Retail", contactTitle: "Student",
      }),
      model
    );
    // The raw product stays visible so the bound is auditable, not hidden.
    expect(worst.stackMultiplier).toBeLessThan(worst.boundedMultiplier);
  });

  it("leaves an unbounded stack untouched", () => {
    const deals = [
      ...cohort("corp", 60, 30, 12_000, { email: "a@acme.com" }),
      ...cohort("free", 60, 8, 6_000, { email: "b@gmail.com" }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const v = valueLead(deal({ id: "x", email: "n@acme.com" }), model);
    expect(v.wasBounded).toBe(false);
    expect(v.stackMultiplier).toBe(v.boundedMultiplier);
  });

  it("still calibrates to the observed mean with the bound in place", () => {
    const deals = [
      ...cohort("good", 60, 30, 12_000, {
        email: "a@acme.com", employeeCount: 800, industry: "Manufacturing", contactTitle: "Director",
      }),
      ...cohort("bad", 60, 3, 2_000, {
        email: "b@gmail.com", employeeCount: 8, industry: "Retail", contactTitle: "Student",
      }),
    ];
    const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
    const valued = valueAllLeads(deals, model);
    const mean = valued.reduce((s, v) => s + v.value, 0) / valued.length;
    expect(mean).toBeCloseTo(model.baseValue, 0);
  });
});

// ---------------------------------------------------------------------------
// Cap applied last
// ---------------------------------------------------------------------------

describe("cap", () => {
  const DEALS = [
    ...cohort("good", 60, 40, 20_000, { email: "a@acme.com", employeeCount: 900 }),
    ...cohort("bad", 60, 4, 2_000, { email: "b@gmail.com", employeeCount: 5 }),
  ];

  it("clips the emitted value and records what it clipped from", () => {
    const model = buildValueModel({ deals: DEALS, cap: 1_000, currencyCode: "USD" });
    const top = valueLead(
      deal({ id: "t", email: "n@acme.com", employeeCount: 900 }),
      model
    );
    expect(top.value).toBeLessThanOrEqual(1_000);
    if (top.cappedFrom !== null) expect(top.cappedFrom).toBeGreaterThan(1_000);
  });

  it("never emits a value above the cap for any lead", () => {
    const model = buildValueModel({ deals: DEALS, cap: 2_500, currencyCode: "USD" });
    for (const v of valueAllLeads(DEALS, model)) {
      expect(v.value).toBeLessThanOrEqual(2_500);
    }
  });

  /*
   * The cap participates in fitting now - won amounts above it are counted at
   * it - so a capped and an uncapped model are legitimately different models.
   * The invariant that survives is the one this test always guarded: clipping
   * at emission must not feed back into calibration. If it did, every clipped
   * whale would re-inflate everyone else's values to compensate, and the cap
   * would be cosmetic.
   */
  it("does not let emission clipping re-inflate the rest through calibration", () => {
    /*
     * Deliberately lopsided: a small, always-winning segment and a large,
     * rarely-winning one. Calibration is anchored by the crowd, so the hot
     * segment's stacked value sails past the cap and gets clipped at
     * emission - which is the only place clipping is allowed to act. (With a
     * balanced file the capped fit compresses values under the cap by itself
     * and there is nothing to clip.)
     */
    const skewed = [
      ...cohort("hot", 25, 25, 20_000, { email: "a@acme.com", employeeCount: 900 }),
      ...cohort("cold", 200, 10, 2_000, { email: "b@gmail.com", employeeCount: 5 }),
    ];
    const model = buildValueModel({ deals: skewed, cap: 2_500, currencyCode: "USD" });
    const valued = valueAllLeads(skewed, model);

    // Calibration balances the RAW stacked values back to base...
    const meanCalibratedRaw =
      valued.reduce((s, v) => s + v.rawValue * model.calibrationFactor, 0) / valued.length;
    expect(meanCalibratedRaw).toBeCloseTo(model.baseValue, 0);


    // ...so what clipping removes stays removed. Nothing pushes back up.
    const meanEmitted = valued.reduce((s, v) => s + v.value, 0) / valued.length;
    expect(meanEmitted).toBeLessThanOrEqual(meanCalibratedRaw + 0.01);
    expect(valued.some((v) => v.cappedFrom !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The everything-is-weak fallback
// ---------------------------------------------------------------------------

describe("flat model fallback", () => {
  const NO_SIGNAL = [
    ...cohort("a", 40, 12, 8_000, { email: "a@acme.com", industry: "Manufacturing" }),
    ...cohort("b", 40, 12, 8_000, { email: "b@other.com", industry: "Logistics" }),
  ];

  it("reports itself as flat when no factor survives", () => {
    const model = buildValueModel({ deals: NO_SIGNAL, cap: null, currencyCode: "USD" });
    expect(model.isFlat).toBe(true);
    expect(model.includedFactors).toHaveLength(0);
    expect(model.droppedFactors.length).toBeGreaterThan(0);
  });

  it("gives every lead the same base value, with no steps to show", () => {
    const model = buildValueModel({ deals: NO_SIGNAL, cap: null, currencyCode: "USD" });
    const valued = valueAllLeads(NO_SIGNAL, model);
    const distinct = new Set(valued.map((v) => v.value));
    expect(distinct.size).toBe(1);
    expect(valued[0].steps).toHaveLength(0);
    expect(valued[0].value).toBeCloseTo(model.baseValue, 2);
  });

  it("explains why each factor was dropped", () => {
    const model = buildValueModel({ deals: NO_SIGNAL, cap: null, currencyCode: "USD" });
    for (const f of model.droppedFactors) {
      expect(f.droppedReason).toBeTruthy();
    }
  });

  it("handles an empty file without throwing", () => {
    const model = buildValueModel({ deals: [], cap: null, currencyCode: "USD" });
    expect(model.isFlat).toBe(true);
    expect(model.baseValue).toBe(0);
    expect(model.fittedOn).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Provenance and overrides
// ---------------------------------------------------------------------------

describe("provenance", () => {
  const DEALS = [
    ...cohort("corp", 60, 30, 12_000, { email: "a@acme.com" }),
    ...cohort("free", 60, 4, 3_000, { email: "b@gmail.com" }),
  ];

  it("carries the sample size and rate behind every step", () => {
    const model = buildValueModel({ deals: DEALS, cap: null, currencyCode: "USD" });
    const v = valueLead(deal({ id: "x", email: "n@acme.com" }), model);
    const step = v.steps[0];
    expect(step.factorLabel).toBe("Email domain");
    expect(step.level).toBe("Corporate email");
    expect(step.sampleSize).toBe(60);
    expect(step.closeRate).toBeCloseTo(0.5, 2);
    expect(step.medianWonAmount).toBe(12_000);
  });

  it("honors a user override in place of the computed multiplier", () => {
    const model = buildValueModel({ deals: DEALS, cap: null, currencyCode: "USD" });
    const overrides = { "domainType::Corporate email": 2 };
    const v = valueLead(deal({ id: "x", email: "n@acme.com" }), model, overrides);
    expect(v.steps[0].multiplier).toBe(2);
  });

  it("builds a best-case stack that ends at the cap when one applies", () => {
    const model = buildValueModel({ deals: DEALS, cap: 500, currencyCode: "USD" });
    const stack = bestCaseStack(model);
    expect(stack.steps.length).toBeGreaterThan(0);
    expect(stack.finalValue).toBeLessThanOrEqual(500);
    expect(stack.baseValue).toBe(model.baseValue);
  });
});

// ---------------------------------------------------------------------------
// Hypotheses from the intake step
// ---------------------------------------------------------------------------

describe("claims from the intake step", () => {
  const CLAIM = { factorKey: "seniority", claim: "our buyers are ops directors", statedLevels: ["Director"] };

  it("reports a claim that the data refutes, rather than dropping it silently", () => {
    // Directors and engineers close identically, so seniority carries no signal.
    const deals = [
      ...cohort("dir", 60, 18, 10_000, { contactTitle: "Director of Operations" }),
      ...cohort("eng", 60, 18, 10_000, { contactTitle: "Process Engineer" }),
    ];
    const model = buildValueModel({
      deals,
      cap: null,
      currencyCode: "USD",
      hypotheses: [CLAIM],
    });

    const seniority = model.factors.find((f) => f.key === "seniority")!;
    expect(seniority.included).toBe(false);
    expect(seniority.userClaim).toBe(CLAIM.claim);
    expect(seniority.statedLevels).toEqual(["Director"]);
    expect(model.refutedClaims.map((f) => f.key)).toContain("seniority");
  });

  it("keeps the claim attached to a factor the data confirms", () => {
    const deals = [
      ...cohort("dir", 60, 36, 20_000, { contactTitle: "Director of Operations" }),
      ...cohort("eng", 60, 6, 6_000, { contactTitle: "Process Engineer" }),
    ];
    const model = buildValueModel({
      deals,
      cap: null,
      currencyCode: "USD",
      hypotheses: [CLAIM],
    });

    const seniority = model.factors.find((f) => f.key === "seniority")!;
    expect(seniority.included).toBe(true);
    expect(seniority.userClaim).toBe(CLAIM.claim);
    expect(model.refutedClaims).toEqual([]);
  });

  it("a claim never becomes a multiplier - the data does", () => {
    const deals = [
      ...cohort("dir", 60, 18, 10_000, { contactTitle: "Director of Operations" }),
      ...cohort("eng", 60, 18, 10_000, { contactTitle: "Process Engineer" }),
    ];
    const claimed = buildValueModel({ deals, cap: null, currencyCode: "USD", hypotheses: [CLAIM] });
    const unclaimed = buildValueModel({ deals, cap: null, currencyCode: "USD" });

    const one = deals[0];
    expect(valueLead(one, claimed).value).toBe(valueLead(one, unclaimed).value);
  });

  it("fits a custom signal column the user pointed us at", () => {
    const deals = [
      ...cohort("big", 60, 36, 20_000, { signals: { "Budget Band": "50k+" } }),
      ...cohort("small", 60, 6, 6_000, { signals: { "Budget Band": "under 10k" } }),
    ];
    const model = buildValueModel({
      deals,
      cap: null,
      currencyCode: "USD",
      customSignalKeys: ["Budget Band"],
      hypotheses: [{ factorKey: "Budget Band", claim: "big budgets close", statedLevels: ["50k+"] }],
    });

    const budget = model.includedFactors.find((f) => f.key === "Budget Band");
    expect(budget).toBeDefined();
    expect(budget!.userClaim).toBe("big budgets close");
    // Still held to the same floor as everything else.
    expect(budget!.levels.every((l) => l.sampleSize >= MIN_LEVEL_SAMPLE)).toBe(true);
  });

  it("drops a custom signal that does not clear the lift threshold, claim or no claim", () => {
    const deals = [
      ...cohort("a", 60, 18, 10_000, { signals: { "Budget Band": "50k+" } }),
      ...cohort("b", 60, 18, 10_000, { signals: { "Budget Band": "under 10k" } }),
    ];
    const model = buildValueModel({
      deals,
      cap: null,
      currencyCode: "USD",
      customSignalKeys: ["Budget Band"],
      hypotheses: [{ factorKey: "Budget Band", claim: "big budgets close", statedLevels: ["50k+"] }],
    });
    expect(model.includedFactors.find((f) => f.key === "Budget Band")).toBeUndefined();
    expect(model.refutedClaims.map((f) => f.key)).toContain("Budget Band");
  });
});

// ---------------------------------------------------------------------------
// Editing multipliers
// ---------------------------------------------------------------------------

describe("user-edited multipliers", () => {
  const deals = [
    ...cohort("corp", 80, 40, 20_000, { email: "a@acme.com" }),
    ...cohort("free", 80, 8, 5_000, { email: "a@gmail.com" }),
  ];
  const model = buildValueModel({ deals, cap: null, currencyCode: "USD" });
  const corporate = model.includedFactors
    .find((f) => f.key === "domainType")!
    .levels.find((l) => l.level === "Corporate email")!;

  it("applies the edit in place of the fitted multiplier", () => {
    const overrides = { "domainType::Corporate email": 5 };
    const edited = withOverrides(model, deals, overrides);
    const lead = deal({ id: "x", email: "someone@acme.com", outcome: "open" });
    const step = valueLead(lead, edited, overrides).steps.find(
      (s) => s.factorKey === "domainType"
    )!;
    expect(step.multiplier).toBe(5);
    expect(corporate.lift).not.toBe(5);
  });

  it("keeps the portfolio calibrated after an edit, rather than letting it drift", () => {
    const overrides = { "domainType::Corporate email": 5 };
    const edited = withOverrides(model, deals, overrides);
    const resolvedDeals = deals.filter((d) => d.outcome !== "open");
    const mean =
      valueAllLeads(resolvedDeals, edited, overrides).reduce((t, v) => t + v.value, 0) /
      resolvedDeals.length;
    expect(mean).toBeCloseTo(model.baseValue, 0);
  });

  it("moves the calibration factor, and does not pretend it is unchanged", () => {
    const edited = withOverrides(model, deals, { "domainType::Corporate email": 5 });
    expect(edited.calibrationFactor).not.toBe(model.calibrationFactor);
  });

  it("leaves the fitted model untouched, so reset really restores it", () => {
    const before = model.calibrationFactor;
    withOverrides(model, deals, { "domainType::Corporate email": 5 });
    expect(model.calibrationFactor).toBe(before);
    expect(valueLead(deals[0], model).value).toBe(
      valueLead(deals[0], buildValueModel({ deals, cap: null, currencyCode: "USD" })).value
    );
  });

  it("ignores an edit that is not a usable multiplier", () => {
    for (const bad of [0, -2, Number.NaN]) {
      expect(effectiveMultiplier("domainType", corporate, { "domainType::Corporate email": bad }))
        .toBe(corporate.lift);
    }
  });

  it("returns the fitted model unchanged when nothing is edited", () => {
    expect(withOverrides(model, deals, {})).toBe(model);
  });

  it("re-picks the best case when an edit makes a different level strongest", () => {
    const overrides = { "domainType::Free webmail": 9 };
    const edited = withOverrides(model, deals, overrides);
    const stack = bestCaseStack(edited, overrides);
    const step = stack.steps.find((s) => s.factorKey === "domainType")!;
    expect(step.level).toBe("Free webmail");
    expect(step.multiplier).toBe(9);
  });
});

describe("the tail counts, up to the cap", () => {
  /**
   * Two industries, identical close rates, identical medians - one with a
   * real tail. `won` amounts are set per deal, which `cohort` cannot do.
   */
  function industryPair(tailAmount: number): MappedDeal[] {
    const group = (name: string, amounts: number[]): MappedDeal[] => [
      ...amounts.map((amount, i) =>
        deal({ id: `${name}-w${i}`, outcome: "won", amount, industry: name })
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        deal({ id: `${name}-l${i}`, industry: name })
      ),
    ];
    return [
      // Ten wins at 6,000 flat.
      ...group("Flatland", Array(10).fill(6_000)),
      // Nine at 6,000 and one big one. Same median, same close rate.
      ...group("Tailville", [...Array(9).fill(6_000), tailAmount]),
    ];
  }

  function industryLifts(deals: MappedDeal[], cap: number | null) {
    const model = buildValueModel({ deals, cap, currencyCode: "USD" });
    const industry = model.factors.find((f) => f.key === "industry")!;
    const flat = industry.levels.find((l) => l.level === "Flatland")!;
    const tail = industry.levels.find((l) => l.level === "Tailville")!;
    return { flat, tail };
  }

  /*
   * The reason the estimator changed. Under the median these two segments
   * priced identically, and the segment that actually brings in the large
   * deals was told it was worth no more than the one that never does.
   */
  it("prices a segment with a tail above one without, at equal medians", () => {
    const { flat, tail } = industryLifts(industryPair(20_000), 50_000);
    expect(flat.medianWonAmount).toBe(tail.medianWonAmount);
    expect(flat.closeRate).toBe(tail.closeRate);
    // Flatland: mean 6,000. Tailville: (9×6,000 + 20,000) / 10 = 7,400.
    expect(flat.avgWonAmount).toBe(6_000);
    expect(tail.avgWonAmount).toBe(7_400);
    expect(tail.lift).toBeGreaterThan(flat.lift);
    expect(tail.expectedValue / flat.expectedValue).toBeCloseTo(7_400 / 6_000, 2);
  });

  it("counts a whale at the cap, not at its face value", () => {
    const { tail } = industryLifts(industryPair(200_000), 21_000);
    // (9×6,000 + 21,000) / 10, not (9×6,000 + 200,000) / 10.
    expect(tail.avgWonAmount).toBe(7_500);
  });

  it("runs the average uncapped when no cap is set", () => {
    const { tail } = industryLifts(industryPair(200_000), null);
    expect(tail.avgWonAmount).toBe(25_400);
  });

  it("keeps the median alongside as context, not arithmetic", () => {
    const { tail } = industryLifts(industryPair(200_000), 21_000);
    expect(tail.medianWonAmount).toBe(6_000);
    expect(tail.expectedValue).toBe(Math.round(tail.closeRate * 7_500));
  });
});
