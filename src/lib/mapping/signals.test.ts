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

  /*
   * Offered rather than skipped now, and left off. A column filled on a tenth
   * of rows is unlikely to price well and is not ours to rule out: the
   * advertiser may know those are the only rows that matter.
   */
  it("offers a mostly empty column but leaves it off", () => {
    const { headers, rows } = file({
      // Two levels, on a tenth of the rows. The earlier fixture indexed on
      // i % 2 over multiples of ten, so every filled row read "A" and the
      // column was excluded as a constant rather than as a thin one.
      promo: (i) => (i % 10 === 0 ? ["A", "B"][(i / 10) % 2] : ""),
    });
    const { discovered } = discoverSignalColumns(headers, rows, []);
    expect(discovered.map((d) => [d.column, d.suggested])).toEqual([["promo", false]]);
    expect(discovered[0].reason).toMatch(/off unless you say otherwise/);
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

  it("suggests up to the level ceiling and merely offers past it", () => {
    const { headers, rows } = file({
      city: (i) => `City ${i % (MAX_LEVELS + 5)}`,
      region: (i) => `Region ${i % 5}`,
    });
    const { discovered } = discoverSignalColumns(headers, rows, []);
    expect(discovered.map((d) => [d.column, d.suggested])).toEqual([
      ["city", false],
      ["region", true],
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
  const sig = (column: string, suggested = true) => ({
    column,
    levels: 4,
    fill: 0.9,
    suggested,
    reason: "",
  });

  it("keeps the assistant's columns first and adds the rest once", () => {
    const merged = signalColumnsFor(["Budget Band"], [sig("Budget Band"), sig("Timeline")]);
    expect(merged).toEqual(["Budget Band", "Timeline"]);
  });

  it("leaves out a column whose shape did not suggest it", () => {
    expect(signalColumnsFor([], [sig("Case type", false)])).toEqual([]);
  });

  /*
   * The thresholds are a judgement about what usually carries signal, not a
   * fact about this file. A column filled on 45% of rows can be the most
   * important thing in it, so the advertiser gets the last word.
   */
  it("tests a column the advertiser switched on despite its shape", () => {
    expect(signalColumnsFor([], [sig("Case type", false)], { "Case type": true }))
      .toEqual(["Case type"]);
  });

  it("drops one they switched off, whoever proposed it", () => {
    expect(signalColumnsFor(["Budget Band"], [sig("Timeline")], {
      "Budget Band": false,
      Timeline: false,
    })).toEqual([]);
  });

  it("does not list a column twice when both readers name it", () => {
    expect(signalColumnsFor(["Timeline"], [sig("Timeline")], { Timeline: true }))
      .toEqual(["Timeline"]);
  });
});

/*
 * The bug behind a consumer's flat report. Detection maps "industry" and
 * "contact_title" on any file whose headers look right. For a consumer the
 * mapping screen hides those fields and the factor list drops them, and
 * discovery then skipped the columns too because the field still claimed
 * them. Three readers each did the right thing and the column vanished.
 */
describe("company fields on a consumer file", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    created: "2026-01-01",
    industry: ["Retail", "Hospitality", "Trades"][i % 3],
    contact_title: ["Owner", "Manager"][i % 2],
    employee_count: String((i % 4) * 10),
  }));
  const headers = Object.keys(rows[0]);
  const fields = [
    { key: "createdAt", label: "Create date", hint: "", required: true, column: "created", confidence: 1, reason: "" },
    { key: "industry", label: "Industry", hint: "", required: false, column: "industry", confidence: 1, reason: "" },
    { key: "contactTitle", label: "Contact title", hint: "", required: false, column: "contact_title", confidence: 1, reason: "" },
    { key: "employeeCount", label: "Employee count", hint: "", required: false, column: "employee_count", confidence: 1, reason: "" },
  ] as DetectedField[];

  it("stay claimed for a business, so they are not tested twice", () => {
    const { discovered } = discoverSignalColumns(headers, rows, fields, "b2b");
    expect(discovered.map((d) => d.column)).toEqual([]);
  });

  it("are handed back to discovery for a consumer", () => {
    const { discovered } = discoverSignalColumns(headers, rows, fields, "b2c");
    expect(discovered.map((d) => d.column).sort()).toEqual(["contact_title", "industry"]);
  });

  it("never release a structural field, whatever the audience", () => {
    const { discovered } = discoverSignalColumns(headers, rows, fields, "b2c");
    expect(discovered.map((d) => d.column)).not.toContain("created");
  });
});
