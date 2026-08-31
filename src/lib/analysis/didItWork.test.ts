import { describe, expect, it } from "vitest";
import {
  CYCLE_COVERAGE_REQUIRED,
  MIN_COHORT,
  PROOF_CAVEAT,
  cohortOutcome,
  didItWork,
  isGoogleSourced,
} from "./didItWork";
import type { MappedDeal } from "./types";

const SWITCH = new Date("2026-04-01T00:00:00Z");
const NOW = new Date("2026-08-30T00:00:00Z");

function deal(over: Partial<MappedDeal> & { id: string; createdAt: Date }): MappedDeal {
  return {
    closedAt: null,
    outcome: "open",
    amount: null,
    stage: null,
    source: "Paid Search",
    email: null,
    clickId: null,
    ...over,
  } as MappedDeal;
}

/** n deals on one side of the switch, of which `won` closed at `amount`. */
function cohort(prefix: string, when: Date, n: number, won: number, amount: number): MappedDeal[] {
  return Array.from({ length: n }, (_, i) =>
    deal({
      id: `${prefix}-${i}`,
      createdAt: when,
      outcome: i < won ? "won" : "lost",
      amount: i < won ? amount : null,
    })
  );
}

const BEFORE = new Date("2026-02-01T00:00:00Z");
const AFTER = new Date("2026-05-01T00:00:00Z");

describe("what a cohort actually did", () => {
  it("measures realised outcomes, not what we predicted", () => {
    const outcome = cohortOutcome(cohort("b", BEFORE, 100, 25, 8000));
    expect(outcome).toMatchObject({
      leads: 100,
      resolved: 100,
      won: 25,
      closeRate: 0.25,
      medianWonAmount: 8000,
      valuePerLead: 2000,
    });
  });

  /*
   * An open lead says nothing about whether it was a good one. Counting it as
   * a loss would punish the newer cohort simply for being newer, which is
   * exactly the bias this whole comparison has to avoid.
   */
  it("ignores leads that have not resolved yet", () => {
    const deals = [
      ...cohort("r", BEFORE, 40, 10, 5000),
      ...Array.from({ length: 60 }, (_, i) => deal({ id: `open-${i}`, createdAt: BEFORE })),
    ];
    const outcome = cohortOutcome(deals);
    expect(outcome.leads).toBe(100);
    expect(outcome.resolved).toBe(40);
    expect(outcome.closeRate).toBe(0.25);
  });

  it("does not invent a value when nothing has been won", () => {
    const outcome = cohortOutcome(cohort("l", BEFORE, 30, 0, 0));
    expect(outcome.medianWonAmount).toBeNull();
    expect(outcome.valuePerLead).toBe(0);
  });
});

describe("refusing to answer", () => {
  it("says so when nothing was ever recorded to compare against", () => {
    expect(
      didItWork({ deals: [], switchedAt: null, medianCycleDays: 20, now: NOW }).kind
    ).toBe("no-baseline");
  });

  /*
   * Judging a 90-day cycle three weeks in measures which cohort had more time
   * to close, not which cohort was better. The answer would look confident and
   * be meaningless.
   */
  it("refuses while the sales cycle has not had time to play out", () => {
    const verdict = didItWork({
      deals: [...cohort("b", BEFORE, 100, 25, 8000), ...cohort("a", AFTER, 100, 40, 9000)],
      switchedAt: new Date("2026-08-20T00:00:00Z"),
      medianCycleDays: 60,
      now: NOW,
    });
    expect(verdict.kind).toBe("too-early");
    if (verdict.kind !== "too-early") return;
    expect(verdict.daysIn).toBe(10);
    expect(verdict.daysNeeded).toBe(90);
    expect(CYCLE_COVERAGE_REQUIRED).toBeGreaterThan(1);
  });

  /*
   * A 40% swing on eleven deals is noise wearing a percentage sign, and
   * showing it would tell somebody to keep paying for something that did
   * nothing.
   */
  it("refuses a cohort too small to mean anything", () => {
    const verdict = didItWork({
      deals: [...cohort("b", BEFORE, 100, 25, 8000), ...cohort("a", AFTER, 11, 6, 9000)],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });
    expect(verdict.kind).toBe("too-few");
    if (verdict.kind !== "too-few") return;
    expect(verdict.after).toBe(11);
    expect(verdict.needed).toBe(MIN_COHORT);
  });
});

describe("when it can answer", () => {
  it("measures the change in what a lead was actually worth", () => {
    const verdict = didItWork({
      // Before: 25% close on 8,000 = 2,000 a lead.
      // After:  30% close on 9,000 = 2,700 a lead. 35% better.
      deals: [...cohort("b", BEFORE, 100, 25, 8000), ...cohort("a", AFTER, 100, 30, 9000)],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.before.valuePerLead).toBe(2000);
    expect(verdict.after.valuePerLead).toBe(2700);
    expect(verdict.change).toBeCloseTo(0.35, 5);
    expect(verdict.improved).toBe(true);
  });

  /*
   * The result that has to be reportable, or the feature is marketing rather
   * than measurement. A tool that can only return good news is not measuring
   * anything.
   */
  it("reports a decline just as readily as an improvement", () => {
    const verdict = didItWork({
      deals: [...cohort("b", BEFORE, 100, 30, 9000), ...cohort("a", AFTER, 100, 25, 8000)],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });
    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.improved).toBe(false);
    expect(verdict.change).toBeLessThan(0);
  });

  it("splits the cohorts on the switch date, not on today", () => {
    const verdict = didItWork({
      deals: [...cohort("b", BEFORE, 60, 15, 8000), ...cohort("a", AFTER, 40, 10, 8000)],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });
    if (verdict.kind !== "measured") throw new Error("expected measured");
    expect(verdict.before.leads).toBe(60);
    expect(verdict.after.leads).toBe(40);
  });

  it("puts a lead created exactly at the switch in the after cohort", () => {
    const verdict = didItWork({
      deals: [
        ...cohort("b", BEFORE, 30, 10, 8000),
        ...cohort("a", SWITCH, 30, 10, 8000),
      ],
      switchedAt: SWITCH,
      medianCycleDays: 5,
      now: NOW,
    });
    if (verdict.kind !== "measured") throw new Error("expected measured");
    expect(verdict.after.leads).toBe(30);
  });
});

describe("the caveat", () => {
  /*
   * A before-and-after is not an experiment. Saying so is what keeps a real
   * result trustworthy, and it is the line between a measurement and a
   * marketing claim.
   */
  it("names the confounds and points at the rigorous version", () => {
    expect(PROOF_CAVEAT).toMatch(/seasonality/i);
    expect(PROOF_CAVEAT).toMatch(/experiment/i);
    expect(PROOF_CAVEAT).toMatch(/not two groups running at the same time/i);
  });
});

describe("using the leads Google never touched as a control", () => {
  /** Same as `cohort`, but every lead carries a Google click ID. */
  function googleCohort(
    prefix: string,
    when: Date,
    n: number,
    won: number,
    amount: number
  ): MappedDeal[] {
    return cohort(prefix, when, n, won, amount).map((d) => ({
      ...d,
      clickId: `gclid-${d.id}`,
    }));
  }

  it("counts a click ID as Google whatever the source column says", () => {
    expect(isGoogleSourced(deal({ id: "c", createdAt: BEFORE, clickId: "abc" }))).toBe(true);
  });

  it("counts a source that names Google", () => {
    expect(isGoogleSourced(deal({ id: "s", createdAt: BEFORE, source: "Google Ads" }))).toBe(true);
    expect(isGoogleSourced(deal({ id: "a", createdAt: BEFORE, source: "adwords" }))).toBe(true);
  });

  /*
   * The error worth making. "cpc" and "paid search" are Bing too, and a Bing
   * lead sitting in the control group only dilutes the control; a Bing lead
   * counted as Google would invent a result.
   */
  it("does not claim an unnamed paid source for Google", () => {
    expect(isGoogleSourced(deal({ id: "p", createdAt: BEFORE, source: "Paid Search" }))).toBe(false);
    expect(isGoogleSourced(deal({ id: "b", createdAt: BEFORE, source: "Bing CPC" }))).toBe(false);
  });

  /*
   * The whole point. Both cohorts improved because the market improved; only
   * the gap between them is ours to claim.
   */
  it("credits the switch with the gap, not with the whole rise", () => {
    const verdict = didItWork({
      deals: [
        // Google: 20% close before, 34% after.
        ...googleCohort("gb", BEFORE, 100, 20, 5000),
        ...googleCohort("ga", AFTER, 100, 34, 5000),
        // Everything else rose too, from 20% to 26%. Not our doing.
        ...cohort("ob", BEFORE, 100, 20, 5000),
        ...cohort("oa", AFTER, 100, 26, 5000),
      ],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });

    expect(verdict.kind).toBe("measured");
    if (verdict.kind !== "measured") return;
    expect(verdict.control.kind).toBe("controlled");
    if (verdict.control.kind !== "controlled") return;

    expect(verdict.control.google.change).toBeCloseTo(0.7, 5);
    expect(verdict.control.other.change).toBeCloseTo(0.3, 5);
    expect(verdict.control.attributable).toBeCloseTo(0.4, 5);
    expect(verdict.control.improved).toBe(true);
  });

  it("reports no gain when everything rose equally", () => {
    const verdict = didItWork({
      deals: [
        ...googleCohort("gb", BEFORE, 100, 20, 5000),
        ...googleCohort("ga", AFTER, 100, 30, 5000),
        ...cohort("ob", BEFORE, 100, 20, 5000),
        ...cohort("oa", AFTER, 100, 30, 5000),
      ],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });

    if (verdict.kind !== "measured" || verdict.control.kind !== "controlled") {
      throw new Error("expected a controlled comparison");
    }
    expect(verdict.control.attributable).toBeCloseTo(0, 5);
    expect(verdict.control.improved).toBe(false);
  });

  it("refuses a control group too small to be one", () => {
    const verdict = didItWork({
      deals: [
        ...googleCohort("gb", BEFORE, 100, 20, 5000),
        ...googleCohort("ga", AFTER, 100, 34, 5000),
        ...cohort("ob", BEFORE, 5, 1, 5000),
        ...cohort("oa", AFTER, 5, 2, 5000),
      ],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });

    if (verdict.kind !== "measured") throw new Error("expected a measurement");
    expect(verdict.control.kind).toBe("no-control");
    if (verdict.control.kind !== "no-control") return;
    expect(verdict.control.reason).toMatch(/came from Google/i);
  });

  it("refuses when too few leads came from Google to judge separately", () => {
    const verdict = didItWork({
      deals: [
        ...cohort("ob", BEFORE, 100, 20, 5000),
        ...cohort("oa", AFTER, 100, 30, 5000),
        ...googleCohort("gb", BEFORE, 4, 1, 5000),
      ],
      switchedAt: SWITCH,
      medianCycleDays: 20,
      now: NOW,
    });

    if (verdict.kind !== "measured") throw new Error("expected a measurement");
    expect(verdict.control.kind).toBe("no-control");
    if (verdict.control.kind !== "no-control") return;
    expect(verdict.control.reason).toMatch(/from a Google ad/i);
  });
});

describe("the gap in money, and whether it is luck", () => {
  function googleCohort2(
    prefix: string,
    when: Date,
    n: number,
    won: number,
    amount: number
  ): MappedDeal[] {
    return cohort(prefix, when, n, won, amount).map((d) => ({
      ...d,
      clickId: `gclid-${d.id}`,
    }));
  }

  function controlled(deals: MappedDeal[]) {
    const verdict = didItWork({ deals, switchedAt: SWITCH, medianCycleDays: 20, now: NOW });
    if (verdict.kind !== "measured" || verdict.control.kind !== "controlled") {
      throw new Error("expected a controlled comparison");
    }
    return verdict.control;
  }

  /*
   * Hand-derived: Google went 1,000 -> 1,700 per lead while the control rose
   * 30%, so a Google lead that merely rode the market would be worth 1,300.
   * The 400 above that, across the 100 resolved Google leads since the
   * switch, is 40,000.
   */
  it("prices the gap against the control trend, not against zero", () => {
    const c = controlled([
      ...googleCohort2("gb", BEFORE, 100, 20, 5000),
      ...googleCohort2("ga", AFTER, 100, 34, 5000),
      ...cohort("ob", BEFORE, 100, 20, 5000),
      ...cohort("oa", AFTER, 100, 26, 5000),
    ]);
    expect(c.worth).not.toBeNull();
    expect(c.worth!.counterfactualPerLead).toBeCloseTo(1300, 2);
    expect(c.worth!.perLead).toBeCloseTo(400, 2);
    expect(c.worth!.resolvedSince).toBe(100);
    expect(c.worth!.total).toBeCloseTo(40_000, 0);
  });

  it("reports a decline as negative money, not as nothing", () => {
    const c = controlled([
      ...googleCohort2("gb", BEFORE, 100, 30, 5000),
      ...googleCohort2("ga", AFTER, 100, 20, 5000),
      ...cohort("ob", BEFORE, 100, 25, 5000),
      ...cohort("oa", AFTER, 100, 25, 5000),
    ]);
    expect(c.worth!.perLead).toBeLessThan(0);
    expect(c.worth!.total).toBeLessThan(0);
  });

  it("does not project from a before-cohort that closed nothing", () => {
    const c = controlled([
      ...googleCohort2("gb", BEFORE, 100, 0, 0),
      ...googleCohort2("ga", AFTER, 100, 34, 5000),
      ...cohort("ob", BEFORE, 100, 20, 5000),
      ...cohort("oa", AFTER, 100, 26, 5000),
    ]);
    expect(c.worth).toBeNull();
  });

  /*
   * A gap that huge on cohorts that big is not luck, and the shuffle test
   * must say so: dealing the same deals into before and after at random
   * almost never reproduces a 10% -> 40% close-rate jump against a flat
   * control.
   */
  it("calls a massive gap on big cohorts unlikely to be chance", () => {
    const c = controlled([
      ...googleCohort2("gb", BEFORE, 400, 40, 5000),
      ...googleCohort2("ga", AFTER, 400, 160, 5000),
      ...cohort("ob", BEFORE, 400, 80, 5000),
      ...cohort("oa", AFTER, 400, 80, 5000),
    ]);
    expect(c.chance.unlikelyChance).toBe(true);
    expect(c.chance.pValue).toBeLessThan(0.05);
  });

  /*
   * And when before and after are drawn from the same world, the shuffles
   * reproduce the observed gap all the time - which is the test refusing to
   * bless noise.
   */
  it("does not bless a gap that shuffling reproduces freely", () => {
    const c = controlled([
      ...googleCohort2("gb", BEFORE, 100, 25, 5000),
      ...googleCohort2("ga", AFTER, 100, 27, 5000),
      ...cohort("ob", BEFORE, 100, 25, 5000),
      ...cohort("oa", AFTER, 100, 26, 5000),
    ]);
    expect(c.chance.unlikelyChance).toBe(false);
    expect(c.chance.pValue).toBeGreaterThan(0.2);
  });

  it("gives the same answer for the same file every time", () => {
    const deals = [
      ...googleCohort2("gb", BEFORE, 100, 20, 5000),
      ...googleCohort2("ga", AFTER, 100, 34, 5000),
      ...cohort("ob", BEFORE, 100, 20, 5000),
      ...cohort("oa", AFTER, 100, 26, 5000),
    ];
    expect(controlled(deals).chance.asExtreme).toBe(controlled(deals).chance.asExtreme);
  });
});
