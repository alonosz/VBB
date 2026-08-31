import { describe, expect, it } from "vitest";
import {
  CYCLE_COVERAGE_REQUIRED,
  MIN_COHORT,
  PROOF_CAVEAT,
  cohortOutcome,
  didItWork,
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
