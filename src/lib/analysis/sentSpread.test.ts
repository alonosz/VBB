import { describe, expect, it } from "vitest";
import { sentValueSpread, WORKABLE_RATIO } from "./sentSpread";

const many = (value: number, times: number) => Array<number>(times).fill(value);

describe("sentValueSpread", () => {
  it("says nothing when nothing is priced", () => {
    expect(sentValueSpread([])).toBeNull();
    expect(sentValueSpread([0, 0, -4])).toBeNull();
  });

  it("calls one repeated value flat, because Google cannot act on a constant", () => {
    const spread = sentValueSpread(many(412, 300))!;
    expect(spread.verdict).toBe("flat");
    expect(spread.distinct).toBe(1);
    expect(spread.because).toMatch(/same amount/i);
  });

  /*
   * The case the ratio alone gets wrong. A tenth of the file in a high tail
   * drags p90 into it, so p90/p10 reads 5.9x and looks healthy - while nine
   * leads in ten carry one identical figure and Google has almost nothing to
   * tell apart. The share guard is what catches this.
   */
  it("calls a file flat when nine leads in ten are on one value, however wide the tail", () => {
    const spread = sentValueSpread([...many(100, 90), ...many(5000, 10)])!;
    expect(spread.ratio!).toBeGreaterThan(WORKABLE_RATIO);
    expect(spread.verdict).toBe("flat");
    expect(spread.because).toMatch(/90%/);
  });

  it("does not let a thin tail flatter the ratio", () => {
    // Only 4% up high, so p90 never reaches it and the ratio stays honest.
    const spread = sentValueSpread([...many(100, 96), ...many(5000, 4)])!;
    expect(spread.ratio).toBe(1);
    expect(spread.verdict).toBe("flat");
  });

  it("calls a small difference narrow rather than useful", () => {
    const values = Array.from({ length: 200 }, (_, i) => 100 + (i % 20));
    const spread = sentValueSpread(values)!;
    expect(spread.ratio).toBeLessThan(WORKABLE_RATIO);
    expect(spread.verdict).toBe("narrow");
  });

  it("calls a genuine spread workable and says by how much", () => {
    const values = Array.from({ length: 200 }, (_, i) => 100 + i * 20);
    const spread = sentValueSpread(values)!;
    expect(spread.verdict).toBe("workable");
    expect(spread.ratio!).toBeGreaterThan(WORKABLE_RATIO);
    expect(spread.because).toMatch(/x your worst/);
  });

  it("reports the percentiles it judged on", () => {
    const spread = sentValueSpread([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])!;
    expect(spread.p50).toBeCloseTo(55, 5);
    expect(spread.p10).toBeCloseTo(19, 5);
    expect(spread.p90).toBeCloseTo(91, 5);
    expect(spread.leads).toBe(10);
  });

  it("survives a single priced lead without dividing by nothing", () => {
    const spread = sentValueSpread([250])!;
    expect(spread.leads).toBe(1);
    expect(spread.p10).toBe(250);
    expect(spread.verdict).toBe("flat");
  });
});
