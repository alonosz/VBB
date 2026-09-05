import { describe, expect, it } from "vitest";
import {
  MAX_LEVELS,
  MIN_FILL,
  discoverSignalColumns,
  protectedReason,
  signalColumnsFor,
} from "./signals";
import type { DetectedField } from "./detect";

function claimed(...columns: string[]): DetectedField[] {
  return columns.map((column, i) => ({
    key: "createdAt",
    label: `f${i}`,
    hint: "",
    required: false,
    column,
    confidence: 0.9,
    reason: null,
    source: "heuristic",
  })) as DetectedField[];
}

function file(cols: Record<string, (i: number) => string>, n = 120) {
  const headers = Object.keys(cols);
  const rows = Array.from({ length: n }, (_, i) =>
    Object.fromEntries(headers.map((h) => [h, cols[h](i)]))
  );
  return { headers, rows };
}

describe("discoverSignalColumns", () => {
  /*
   * The whole reason this exists: a consumer file with no assistant and no
   * B2B columns still has its signal noticed.
   */
  it("finds a short category column nothing else claimed", () => {
    const { headers, rows } = file({
      created: (i) => `2026-01-${(i % 28) + 1}`,
      case_type: (i) => ["Personal injury", "Immigration", "Family", "Traffic"][i % 4],
    });
    const { discovered } = discoverSignalColumns(headers, rows, claimed("created"));
    expect(discovered.map((d) => d.column)).toEqual(["case_type"]);
    expect(discovered[0].levels).toBe(4);
    expect(discovered[0].reason).toMatch(/4 distinct values/);
  });

  it("never picks a column a field already claimed", () => {
    const { headers, rows } = file({
      stage: (i) => ["New", "Qualified", "Won"][i % 3],
    });
    expect(discoverSignalColumns(headers, rows, claimed("stage")).discovered).toEqual([]);
  });

  it("skips an identifier, free text, and a near-constant", () => {
    const { headers, rows } = file({
      ticket: (i) => `T-${i}`,
      notes_text: (i) => `Called on day ${i} and left a message about ${i * 7}`,
      country: () => "US",
    });
    expect(discoverSignalColumns(headers, rows, []).discovered).toEqual([]);
  });

  it("skips columns that are measurements or dates rather than categories", () => {
    const { headers, rows } = file({
      loan_amount: (i) => String(1000 + i * 250),
      last_touch: (i) => `2026-03-${(i % 28) + 1}`,
    });
    expect(discoverSignalColumns(headers, rows, []).discovered).toEqual([]);
  });

  it("skips a mostly empty column", () => {
    const { headers, rows } = file({
      promo: (i) => (i % 10 === 0 ? ["A", "B"][i % 2] : ""),
    });
    const { discovered } = discoverSignalColumns(headers, rows, []);
    expect(discovered).toEqual([]);
    expect(MIN_FILL).toBeGreaterThan(0.1);
  });

  it("skips a column about the rep or the record, not the lead", () => {
    const { headers, rows } = file({
      owner: (i) => ["Dana", "Sam", "Lee"][i % 3],
      deal_owner: (i) => ["Dana", "Sam", "Lee"][i % 3],
      first_name: (i) => ["Ann", "Bo", "Cy"][i % 3],
    });
    expect(discoverSignalColumns(headers, rows, []).discovered).toEqual([]);
  });

  it("stops at the level ceiling, where a column stops being a category", () => {
    const { headers, rows } = file({
      city: (i) => `City ${i % (MAX_LEVELS + 5)}`,
      region: (i) => `Region ${i % 5}`,
    });
    expect(discoverSignalColumns(headers, rows, []).discovered.map((d) => d.column)).toEqual([
      "region",
    ]);
  });

  /*
   * A protected column with a perfect categorical shape is the dangerous
   * case: it would price beautifully and put the advertiser in breach. It is
   * refused before its shape is even looked at, and the refusal is visible.
   */
  it("refuses a protected characteristic and says why, however good its shape", () => {
    const { headers, rows } = file({
      age_band: (i) => ["18-24", "25-34", "35-44", "45+"][i % 4],
      credit_score_band: (i) => ["Poor", "Fair", "Good"][i % 3],
      coverage_requested: (i) => ["Basic", "Standard", "Full"][i % 3],
    });
    const { discovered, refused } = discoverSignalColumns(headers, rows, []);
    expect(discovered.map((d) => d.column)).toEqual(["coverage_requested"]);
    expect(refused.map((r) => r.column).sort()).toEqual(["age_band", "credit_score_band"]);
    expect(refused[0].reason).toMatch(/never price a lead on it/);
    expect(refused[0].reason).toMatch(/discrimination law/);
  });

  it("names the category it refused on", () => {
    expect(protectedReason("Gender")).toMatch(/gender/);
    expect(protectedReason("Date of Birth")).toMatch(/age/);
    expect(protectedReason("FICO")).toMatch(/credit/);
    expect(protectedReason("Coverage")).toBeNull();
    expect(protectedReason("Product line")).toBeNull();
  });
});

describe("signalColumnsFor", () => {
  it("keeps the assistant's columns first and adds the rest once", () => {
    const merged = signalColumnsFor(
      ["Budget Band"],
      [
        { column: "Budget Band", levels: 3, fill: 1, reason: "" },
        { column: "Timeline", levels: 4, fill: 0.9, reason: "" },
      ]
    );
    expect(merged).toEqual(["Budget Band", "Timeline"]);
  });
});
