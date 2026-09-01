import { describe, expect, it } from "vitest";
import { MIN_MIX_LEADS, mixShift } from "./mixShift";
import { buildValueModel } from "./valueModel";
import type { MappedDeal } from "./types";

const SWITCH = new Date("2026-04-01T00:00:00Z");
const BEFORE = new Date("2026-02-01T00:00:00Z");
const AFTER = new Date("2026-05-01T00:00:00Z");

/**
 * Two kinds of lead the model can tell apart: big corporate buyers who close
 * well, and small free-webmail ones who rarely do.
 */
function lead(
  id: string,
  createdAt: Date,
  rich: boolean,
  google: boolean,
  outcome: MappedDeal["outcome"] = "open"
): MappedDeal {
  return {
    id,
    createdAt,
    closedAt: outcome === "open" ? null : createdAt,
    outcome,
    amount: outcome === "won" ? (rich ? 20_000 : 3_000) : null,
    stage: null,
    source: google ? "Google Ads" : "Referral",
    email: rich ? `${id}@acme.com` : `${id}@gmail.com`,
    clickId: google ? `gclid-${id}` : null,
    employeeCount: rich ? 900 : 5,
  };
}

/** History the model is fitted on: rich leads close, poor ones mostly do not. */
function history(): MappedDeal[] {
  const deals: MappedDeal[] = [];
  for (let i = 0; i < 120; i++) {
    deals.push(lead(`hr${i}`, BEFORE, true, true, i < 48 ? "won" : "lost"));
    deals.push(lead(`hp${i}`, BEFORE, false, true, i < 6 ? "won" : "lost"));
  }
  return deals;
}

/**
 * `richAfter` of every 10 post-switch leads are the valuable kind.
 *
 * Emitted in chronological blocks - every "before" lead, then every "after"
 * one - because that is how a CRM export arrives, and because interleaving
 * them would hide a broken permutation test: slicing an already-alternating
 * array splits it into two identical halves whether or not anything shuffled
 * it first.
 */
function arrivals(richBefore: number, richAfter: number, google = true): MappedDeal[] {
  const prefix = google ? "g" : "o";
  return [
    ...Array.from({ length: 400 }, (_, i) =>
      lead(`${prefix}b${i}`, BEFORE, i % 10 < richBefore, google)
    ),
    ...Array.from({ length: 400 }, (_, i) =>
      lead(`${prefix}a${i}`, AFTER, i % 10 < richAfter, google)
    ),
  ];
}

/*
 * The model is fitted on closed history; the mix is measured on the arrivals
 * only. Keeping them separate is both realistic and the only way the counts
 * in these tests mean what they say - history is all pre-switch, so folding
 * it into the measured set would quietly stuff the "before" cohort.
 */
function run(deals: MappedDeal[], switchedAt: Date | null = SWITCH) {
  const model = buildValueModel({
    deals: [...history(), ...deals],
    cap: 60_000,
    currencyCode: "USD",
  });
  return { verdict: mixShift({ deals, model, switchedAt }), model };
}

describe("has the mix of leads Google buys actually changed", () => {
  it("needs a switch date before it can compare anything", () => {
    expect(run(arrivals(3, 3), null).verdict.kind).toBe("no-baseline");
  });

  it("refuses a cohort too small to read a share from", () => {
    const thin = [
      ...Array.from({ length: 40 }, (_, i) => lead(`tb${i}`, BEFORE, true, true)),
      ...Array.from({ length: 40 }, (_, i) => lead(`ta${i}`, AFTER, true, true)),
    ];
    const v = run(thin).verdict;
    expect(v.kind).toBe("too-few");
    if (v.kind !== "too-few") return;
    expect(v.needed).toBe(MIN_MIX_LEADS);
  });

  /*
   * The headline case. Google went from 3 rich leads in 10 to 7, which is
   * exactly what value bidding is supposed to do, and it is visible from lead
   * attributes alone - not one of these deals has closed.
   */
  it("sees a richer mix from open leads that have closed nothing", () => {
    const v = run(arrivals(3, 7)).verdict;
    expect(v.kind).toBe("measured");
    if (v.kind !== "measured") return;
    expect(v.scoreAfter).toBeGreaterThan(v.scoreBefore);
    expect(v.change).toBeGreaterThan(0.2);
    expect(v.googleBefore).toBe(400);
    expect(v.googleAfter).toBe(400);
  });

  it("names which segments moved, and by how much", () => {
    const v = run(arrivals(3, 7)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    const size = v.movers.find((m) => m.factorKey === "employeeBand" && m.level === "201–1,000");
    expect(size).toBeDefined();
    expect(size!.beforeShare).toBeCloseTo(0.3, 2);
    expect(size!.afterShare).toBeCloseTo(0.7, 2);
    // Sorted by how far each moved, so the biggest story is first.
    expect(Math.abs(v.movers[0].shift)).toBeGreaterThanOrEqual(
      Math.abs(v.movers[v.movers.length - 1].shift)
    );
  });

  /*
   * The power claim, which is the whole reason this exists: a shift this
   * clear is called unlikely-to-be-luck on open leads, where the outcome
   * comparison would still be waiting for them to close.
   */
  it("calls a clear shift unlikely to be chance", () => {
    const v = run(arrivals(3, 7)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(v.chance.unlikelyChance).toBe(true);
  });

  it("does not bless a mix that did not move", () => {
    const v = run(arrivals(4, 4)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(Math.abs(v.change)).toBeLessThan(0.05);
    expect(v.chance.unlikelyChance).toBe(false);
  });

  /*
   * A rise that happened everywhere is the market, not the bidding. The
   * control subtracts it, exactly as the outcome comparison does.
   */
  it("subtracts a shift that happened off Google too", () => {
    const v = run([...arrivals(3, 7), ...arrivals(3, 7, false)]).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(v.controlChange).not.toBeNull();
    expect(v.attributable!).toBeCloseTo(0, 1);
    expect(v.chance.unlikelyChance).toBe(false);
  });

  it("says so rather than guessing when there is no usable control", () => {
    const v = run(arrivals(3, 7)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(v.controlChange).toBeNull();
    expect(v.attributable).toBeNull();
  });

  it("gives the same answer for the same file every time", () => {
    const a = run(arrivals(3, 7)).verdict;
    const b = run(arrivals(3, 7)).verdict;
    if (a.kind !== "measured" || b.kind !== "measured") throw new Error("expected measurements");
    expect(a.chance.asExtreme).toBe(b.chance.asExtreme);
  });
});

describe("pipeline, the number that goes in the board pack", () => {
  it("totals the expected value of every Google lead since the switch", () => {
    const v = run(arrivals(3, 7)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    // 400 leads since, each worth the post-switch average. Compared
    // relatively: the average is rounded to the cent before it is multiplied
    // out, so a few hundredths drift across a seven-figure total.
    expect(v.pipeline.createdSince / (v.scoreAfter * 400)).toBeCloseTo(1, 5);
    expect(v.pipeline.createdSince).toBeGreaterThan(0);
  });

  /*
   * Windows of different lengths must not be compared raw, or a longer
   * "before" period looks like a decline all by itself.
   */
  it("reports a monthly rate so unequal windows still compare", () => {
    const v = run(arrivals(3, 7)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(v.pipeline.perMonthAfter).toBeGreaterThan(v.pipeline.perMonthBefore);
  });

  /*
   * Attribution holds volume constant. A rise that happened off Google too is
   * the market, so nothing is claimed for it.
   */
  it("claims nothing when the rise happened everywhere", () => {
    const v = run([...arrivals(3, 7), ...arrivals(3, 7, false)]).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(v.pipeline.attributable).not.toBeNull();
    expect(Math.abs(v.pipeline.attributable!)).toBeLessThan(v.pipeline.createdSince * 0.1);
  });

  it("claims the gap when the control stayed put", () => {
    const v = run([...arrivals(3, 7), ...arrivals(3, 3, false)]).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    // Control flat, so the whole per-lead rise is ours, times 400 leads.
    expect(v.pipeline.attributable! / ((v.scoreAfter - v.scoreBefore) * 400)).toBeCloseTo(
      1,
      5
    );
    expect(v.pipeline.attributable!).toBeGreaterThan(0);
  });

  it("does not claim pipeline without a control to compare against", () => {
    const v = run(arrivals(3, 7)).verdict;
    if (v.kind !== "measured") throw new Error("expected a measurement");
    expect(v.pipeline.attributable).toBeNull();
    // The honest total still stands on its own.
    expect(v.pipeline.createdSince).toBeGreaterThan(0);
  });
});
