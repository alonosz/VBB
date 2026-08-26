import { describe, expect, it } from "vitest";
import { SIZE_BANDS, describeSizeSelection, sizeFit, sizeBandById } from "./statedProfile";
import type { MappedDeal } from "./types";

function deal(p: { id: string; won: boolean; amount?: number; employees?: number | null }): MappedDeal {
  return {
    id: p.id,
    createdAt: new Date("2026-06-01"),
    closedAt: new Date("2026-06-10"),
    outcome: p.won ? "won" : "lost",
    amount: p.amount ?? null,
    stage: null, source: null, email: null, clickId: null,
    employeeCount: p.employees ?? null,
  };
}

describe("size bands", () => {
  it("offers the bands an advertiser thinks in", () => {
    expect(SIZE_BANDS.map((b) => b.id)).toEqual([
      "solo", "2-10", "10-50", "50-100", "100-1000", "1000+",
    ]);
  });

  it("reads a single choice back as its own label", () => {
    expect(describeSizeSelection(["50-100"])).toBe("50–100");
  });

  it("collapses a contiguous choice into one range", () => {
    expect(describeSizeSelection(["50-100", "100-1000"])).toBe("50–1,000");
  });

  it("says '+' when the top band is chosen", () => {
    expect(describeSizeSelection(["100-1000", "1000+"])).toBe("100+");
  });

  it("says nothing when nothing is chosen", () => {
    expect(describeSizeSelection([])).toBe("");
    expect(describeSizeSelection(["nonsense"])).toBe("");
  });

  it("covers a one-person company", () => {
    const solo = sizeBandById("solo")!;
    expect(solo.min).toBe(1);
    expect(solo.max).toBe(2);
  });
});

describe("sizeFit", () => {
  const deals = [
    deal({ id: "1", won: true, amount: 80_000, employees: 400 }),
    deal({ id: "2", won: true, amount: 20_000, employees: 300 }),
    deal({ id: "3", won: true, amount: 10_000, employees: 5 }),
    deal({ id: "4", won: false, amount: 99_000, employees: 800 }),
    deal({ id: "5", won: true, amount: 5_000, employees: null }),
  ];

  it("measures the share of won revenue from the stated size", () => {
    const r = sizeFit(deals, ["100-1000"]);
    expect(r.available).toBe(true);
    // 100k of 110k countable won revenue.
    expect(r.wonRevenueShare).toBeCloseTo(0.909, 2);
    expect(r.wonInside).toBe(2);
    expect(r.wonOutside).toBe(1);
  });

  it("ignores deals that are not won — an open deal has produced nothing", () => {
    const r = sizeFit(deals, ["100-1000"]);
    expect(r.wonInside + r.wonOutside).toBe(3);
  });

  it("ignores won deals with no headcount rather than guessing one", () => {
    const r = sizeFit(deals, ["2-10"]);
    expect(r.wonInside).toBe(1);
    expect(r.wonOutside).toBe(2);
  });

  it("reports which of the engine's own bands the claim touches", () => {
    expect(sizeFit(deals, ["100-1000"]).engineBands).toEqual(["201–1,000"]);
  });

  it("flags a small sample rather than presenting it as a finding", () => {
    expect(sizeFit(deals, ["100-1000"]).lowConfidence).toBe(true);
    const many = Array.from({ length: 25 }, (_, i) =>
      deal({ id: `m${i}`, won: true, amount: 1000, employees: 500 })
    );
    expect(sizeFit(many, ["100-1000"]).lowConfidence).toBe(false);
  });

  it("says nothing when no size was claimed", () => {
    expect(sizeFit(deals, []).available).toBe(false);
  });

  it("says nothing when no deal carries a headcount", () => {
    const blind = [deal({ id: "a", won: true, amount: 1000 })];
    expect(sizeFit(blind, ["100-1000"]).available).toBe(false);
  });

  it("counts a multi-band selection as one claim", () => {
    const r = sizeFit(deals, ["2-10", "100-1000"]);
    expect(r.wonInside).toBe(3);
    expect(r.wonRevenueShare).toBe(1);
  });
});
