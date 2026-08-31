import { describe, expect, it } from "vitest";
import { CLAIM_LIFT_FLOOR, findLevel, judgeClaim } from "./judgeClaim";
import type { FactorLevel, ModelFactor } from "./valueModel";

function level(over: Partial<FactorLevel> & { level: string; lift: number }): FactorLevel {
  return {
    sampleSize: 50,
    won: 15,
    closeRate: 0.3,
    medianWonAmount: 8000,
    avgWonAmount: 8000,
    expectedValue: 2400,
    usable: true,
    ...over,
  };
}

function factor(over: Partial<ModelFactor> = {}): ModelFactor {
  return {
    key: "seniority",
    label: "Contact seniority",
    levels: [
      level({ level: "Manager", lift: 1.676 }),
      level({ level: "Director", lift: 1.333 }),
      level({ level: "C-level", lift: 0.708 }),
    ],
    strongestLift: 1.676,
    included: true,
    droppedReason: null,
    userClaim: "C-level contacts are the ones that close",
    statedLevels: ["C-level"],
    ...over,
  };
}

describe("the bug this exists for", () => {
  /*
   * Found on the first real run. Contact seniority made the model, so the
   * report said the claim held up, and quoted Manager at 1.68x because that is
   * the strongest level. The advertiser had said C-level, which measured
   * 0.71x - well below their average lead. The claim was refuted and the
   * screen called it confirmed.
   */
  it("refuses to confirm a claim whose own level is below average", () => {
    const verdict = judgeClaim(factor());
    expect(verdict.kind).toBe("refuted");
    if (verdict.kind !== "refuted") return;
    expect(verdict.because).toBe("wrong-level");
    // Their level, measured, so the screen can show what it actually is.
    expect(verdict.level?.level).toBe("C-level");
    expect(verdict.level?.lift).toBe(0.708);
    // And the one that really is strongest, which is the useful half.
    expect(verdict.strongest?.level).toBe("Manager");
  });

  it("still confirms a claim that names the level the data agrees with", () => {
    const verdict = judgeClaim(factor({ statedLevels: ["Manager"] }));
    expect(verdict.kind).toBe("confirmed");
    if (verdict.kind !== "confirmed") return;
    expect(verdict.level.level).toBe("Manager");
  });
});

describe("a factor that never made the model", () => {
  it("is refuted whatever level they named", () => {
    const verdict = judgeClaim(
      factor({ included: false, droppedReason: "no level cleared the lift threshold" })
    );
    expect(verdict.kind).toBe("refuted");
    if (verdict.kind !== "refuted") return;
    expect(verdict.because).toBe("factor-dropped");
  });
});

describe("claims we cannot judge either way", () => {
  /*
   * Saying "that did not hold up" about a value that is not in the file at all
   * would be reporting a measurement we never made.
   */
  it("says untested when the named value is not in the file", () => {
    const verdict = judgeClaim(factor({ statedLevels: ["Founder"] }));
    expect(verdict.kind).toBe("untested");
    if (verdict.kind !== "untested") return;
    expect(verdict.reason).toMatch(/does not appear in this file/);
  });

  it("says untested when the named level has too few deals", () => {
    const verdict = judgeClaim(
      factor({
        statedLevels: ["C-level"],
        levels: [level({ level: "Manager", lift: 1.6 }), level({ level: "C-level", lift: 3, usable: false })],
      })
    );
    expect(verdict.kind).toBe("untested");
    if (verdict.kind !== "untested") return;
    expect(verdict.reason).toMatch(/too few resolved deals/);
  });
});

describe("the details", () => {
  it("takes their best named level when they named several", () => {
    const verdict = judgeClaim(factor({ statedLevels: ["C-level", "Manager"] }));
    // Partly right is right: the half that holds up is the half that prices.
    expect(verdict.kind).toBe("confirmed");
    if (verdict.kind !== "confirmed") return;
    expect(verdict.level.level).toBe("Manager");
  });

  it("confirms the strongest level when they named the factor but no level", () => {
    const verdict = judgeClaim(factor({ statedLevels: [] }));
    expect(verdict.kind).toBe("confirmed");
    if (verdict.kind !== "confirmed") return;
    expect(verdict.level.level).toBe("Manager");
  });

  it("does not confirm a level that is barely above average", () => {
    const verdict = judgeClaim(
      factor({ statedLevels: ["Director"], levels: [level({ level: "Director", lift: 1.02 })] })
    );
    expect(verdict.kind).toBe("refuted");
    expect(CLAIM_LIFT_FLOOR).toBeGreaterThan(1);
  });

  it("does not point at a strongest level when it is the one they named", () => {
    const verdict = judgeClaim(
      factor({ statedLevels: ["C-level"], levels: [level({ level: "C-level", lift: 0.7 })] })
    );
    if (verdict.kind !== "refuted") throw new Error("expected refuted");
    expect(verdict.strongest).toBeNull();
  });

  it("matches the way a person types a level, not the way a CRM stores it", () => {
    const levels = [level({ level: "C-level", lift: 0.7 })];
    expect(findLevel(levels, "c-level")?.level).toBe("C-level");
    expect(findLevel(levels, " C Level ")?.level).toBe("C-level");
    expect(findLevel(levels, "clevel")?.level).toBe("C-level");
    expect(findLevel(levels, "VP")).toBeNull();
  });
});
