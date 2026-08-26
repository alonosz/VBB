import { describe, expect, it } from "vitest";
import {
  gateValue, gateStatusFor, reachedGate, MIN_GATE_LIFT, MAX_GATE_MULTIPLIER,
} from "./gateValue";
import { earlyGateDetection } from "./earlyGate";
import type { MappedDeal, EarlyGateResult } from "./types";

const NOW = new Date("2026-06-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function deal(p: {
  id: string; won: boolean; amount?: number;
  gateDays?: number | null; createdDaysAgo?: number;
}): MappedDeal {
  return {
    id: p.id,
    createdAt: daysAgo(p.createdDaysAgo ?? 30),
    closedAt: daysAgo(1),
    outcome: p.won ? "won" : "lost",
    amount: p.won ? (p.amount ?? 10_000) : null,
    stage: null, source: null, email: null, clickId: null,
    stageReachedAfterDays:
      p.gateDays === null || p.gateDays === undefined ? undefined : { Qualified: p.gateDays },
  };
}

/** A gate the detector would recommend: fires fast, plenty of deals. */
const GATE: EarlyGateResult = {
  available: true,
  candidates: [{ stage: "Qualified", reachedCount: 100, withinWindowRate: 0.8 }],
  recommended: { stage: "Qualified", reachedCount: 100, withinWindowRate: 0.8 },
  message: null,
};

/** Reaching the gate triples the close rate. */
const SEPARATING = [
  ...Array.from({ length: 40 }, (_, i) => deal({ id: `r${i}`, won: i < 24, gateDays: 2 })),
  ...Array.from({ length: 40 }, (_, i) => deal({ id: `n${i}`, won: i < 6 })),
];

describe("pricing the gate", () => {
  it("prices reaching the gate against the whole resolved population", () => {
    const g = gateValue(SEPARATING, GATE);
    expect(g.available).toBe(true);
    expect(g.stage).toBe("Qualified");
    // 60% close against an overall 37.5% — 1.6x, not the 4x you get by
    // comparing only against the leads that never qualified.
    expect(g.multiplier).toBeCloseTo(1.6, 1);
    expect(g.closeRateReached).toBeCloseTo(0.6, 2);
    expect(g.closeRateNotReached).toBeCloseTo(0.15, 2);
  });

  it("refuses to read a near-zero baseline as a huge multiplier", () => {
    // Leads that never qualify almost never close. Dividing by that produces
    // a multiplier in the dozens off arithmetic, not evidence.
    const lopsided = [
      ...Array.from({ length: 60 }, (_, i) => deal({ id: `r${i}`, won: i < 30, gateDays: 2 })),
      ...Array.from({ length: 60 }, (_, i) => deal({ id: `n${i}`, won: i < 1 })),
    ];
    const g = gateValue(lopsided, GATE);
    expect(g.available).toBe(true);
    expect(g.multiplier).toBeLessThanOrEqual(MAX_GATE_MULTIPLIER);
    expect(g.rawMultiplier).toBeGreaterThan(1.5);
  });

  it("says when a multiplier was clipped rather than clipping it silently", () => {
    // A small gate group that always wins, against a large one that rarely
    // does. Measuring against the overall population is self-limiting when the
    // gate group is half the file, so the bound only binds when it is a
    // minority — which is exactly when a marginal lift is least trustworthy.
    const skewed = [
      ...Array.from({ length: 30 }, (_, i) => deal({ id: `r${i}`, won: true, amount: 50_000, gateDays: 2 })),
      ...Array.from({ length: 200 }, (_, i) => deal({ id: `n${i}`, won: i < 2, amount: 500 })),
    ];
    const g = gateValue(skewed, GATE);
    expect(g.wasBounded).toBe(true);
    expect(g.multiplier).toBe(MAX_GATE_MULTIPLIER);
    expect(g.rawMultiplier!).toBeGreaterThan(MAX_GATE_MULTIPLIER);
  });

  it("does not bind the bound when the gate group is a big share of the file", () => {
    // Half the leads reaching the gate cannot be worth 4x the average, and the
    // arithmetic reflects that without needing the bound.
    const g = gateValue(SEPARATING, GATE);
    expect(g.wasBounded).toBe(false);
  });

  it("refuses a gate that separates too weakly to be worth an adjustment", () => {
    const flat = [
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `r${i}`, won: i < 12, gateDays: 2 })),
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `n${i}`, won: i < 11 })),
    ];
    const g = gateValue(flat, GATE);
    expect(g.available).toBe(false);
    expect(g.multiplier).toBeLessThan(MIN_GATE_LIFT);
    expect(g.unusableReason).toMatch(/below the 1\.3x threshold/);
  });

  it("refuses a gate with too few deals on one side", () => {
    const thin = [
      ...Array.from({ length: 5 }, (_, i) => deal({ id: `r${i}`, won: true, gateDays: 2 })),
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `n${i}`, won: i < 6 })),
    ];
    const g = gateValue(thin, GATE);
    expect(g.available).toBe(false);
    expect(g.unusableReason).toMatch(/too few on one side/);
  });

  it("says so when no stage fires inside the window at all", () => {
    const noGate: EarlyGateResult = {
      available: false, candidates: [], recommended: null,
      message: "No reliable early gate found — this export has no stage-timing data to measure.",
    };
    const g = gateValue(SEPARATING, noGate);
    expect(g.available).toBe(false);
    expect(g.unusableReason).toMatch(/no stage-timing data/);
  });

  it("refuses to divide by a baseline of zero", () => {
    const nobodyCloses = [
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `r${i}`, won: false, gateDays: 2 })),
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `n${i}`, won: false })),
    ];
    const g = gateValue(nobodyCloses, GATE);
    expect(g.available).toBe(false);
    expect(g.unusableReason).toMatch(/no baseline/);
  });
});

// ---------------------------------------------------------------------------
// Whether it fired in time — the half that decides if Google listens
// ---------------------------------------------------------------------------

describe("gateStatusFor", () => {
  it("a lead that reached the gate quickly, on a fresh conversion, is in time", () => {
    const s = gateStatusFor(deal({ id: "a", won: false, gateDays: 1, createdDaysAgo: 2 }), "Qualified", NOW);
    expect(s).toEqual({ reached: true, inTime: true, daysToReach: 1 });
  });

  it("a lead that took longer than the window is reached but too late", () => {
    // The demo happened, but on day 12. Google has stopped listening.
    const s = gateStatusFor(deal({ id: "a", won: false, gateDays: 12, createdDaysAgo: 13 }), "Qualified", NOW);
    expect(s.reached).toBe(true);
    expect(s.inTime).toBe(false);
  });

  it("a quick gate on an old conversion is still too late", () => {
    // It reached the gate on day 1 — but that was forty days ago, and the
    // window is measured from the conversion, not from the gate.
    const s = gateStatusFor(deal({ id: "a", won: false, gateDays: 1, createdDaysAgo: 40 }), "Qualified", NOW);
    expect(s.reached).toBe(true);
    expect(s.inTime).toBe(false);
  });

  it("treats day 7 as already too late, as Google does", () => {
    const s = gateStatusFor(deal({ id: "a", won: false, gateDays: 7, createdDaysAgo: 7 }), "Qualified", NOW);
    expect(s.inTime).toBe(false);
  });

  it("a lead that never reached the gate keeps its day-0 value", () => {
    const s = gateStatusFor(deal({ id: "a", won: false }), "Qualified", NOW);
    expect(s).toEqual({ reached: false, inTime: false, daysToReach: null });
  });

  it("is inert when there is no gate to check", () => {
    expect(gateStatusFor(deal({ id: "a", won: false, gateDays: 1 }), null, NOW).reached).toBe(false);
  });
});

describe("reachedGate", () => {
  it("ignores a negative or nonsense duration rather than trusting it", () => {
    const bad: MappedDeal = { ...deal({ id: "x", won: false }), stageReachedAfterDays: { Qualified: -3 } };
    expect(reachedGate(bad, "Qualified")).toBeNull();
  });
});

describe("it works off what earlyGateDetection actually recommends", () => {
  it("prices the stage the detector picked", () => {
    const deals = [
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `r${i}`, won: i < 24, gateDays: 2 })),
      ...Array.from({ length: 40 }, (_, i) => deal({ id: `n${i}`, won: i < 6 })),
    ];
    const detected = earlyGateDetection(deals);
    expect(detected.recommended?.stage).toBe("Qualified");
    expect(gateValue(deals, detected).available).toBe(true);
  });
});
