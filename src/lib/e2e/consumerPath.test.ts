import { describe, expect, it } from "vitest";
import { detectColumns, detectStageTimingColumns } from "@/lib/mapping/detect";
import { discoverSignalColumns, signalColumnsFor } from "@/lib/mapping/signals";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic } from "@/lib/analysis";
import { generateConsumerDemoRows } from "@/lib/fixtures/consumerDataset";
import { saveValueModel, loadSavedModel, savedModelToValueModel } from "@/lib/model/savedModel";
import { valueAllLeads } from "@/lib/analysis/valueModel";

/**
 * The reason the fork exists, as one test.
 *
 * A consumer file with no assistant call at all: no API key, no description,
 * no claims. Before discovery, this file got exactly zero factors - the four
 * built-ins are B2B and never fire on it, and nothing else could name a
 * column - and every quote request was priced the same. That is the failure
 * the product exists to prevent, so this is the regression test that matters.
 */
describe("a consumer file, with no assistant", () => {
  const rows = generateConsumerDemoRows();
  const headers = Object.keys(rows[0]);
  const { fields } = detectColumns(headers, rows);
  const stageTiming = detectStageTimingColumns(headers, rows);
  const { discovered, refused } = discoverSignalColumns(headers, rows, fields);
  const customSignalKeys = signalColumnsFor([], discovered);
  const mapped = rowsToDeals({ rows, fields, stageTiming, signalColumns: customSignalKeys });
  const result = runDiagnostic({
    deals: mapped.deals,
    excluded: mapped.excluded,
    currencyCode: "USD",
    customSignalKeys,
    audience: "b2c",
    now: new Date("2026-09-05T00:00:00Z"),
  });

  it("maps the structural columns without help", () => {
    const col = (k: string) => fields.find((f) => f.key === k)?.column;
    expect(col("createdAt")).toBe("created_at");
    expect(col("closedAt")).toBe("closed_at");
    expect(col("outcome")).toBe("outcome");
    expect(col("amount")).toBe("premium_amount");
    expect(col("email")).toBe("contact_email");
    expect(col("clickId")).toBe("gclid");
  });

  it("finds the columns that carry the signal, from the file alone", () => {
    const found = discovered.map((d) => d.column);
    for (const c of ["product_line", "coverage_tier", "currently_insured", "timeline", "state"]) {
      expect(found).toContain(c);
    }
  });

  it("refuses the age band on purpose, and says so", () => {
    expect(refused.map((r) => r.column)).toEqual(["age_band"]);
    expect(refused[0].reason).toMatch(/never price a lead on it/);
    expect(customSignalKeys).not.toContain("age_band");
  });

  it("does not test the four business factors on a consumer file", () => {
    const keys = result.valueModel.factors.map((f) => f.key);
    for (const k of ["domainType", "employeeBand", "industry", "seniority"]) {
      expect(keys).not.toContain(k);
    }
  });

  /*
   * The number that was zero before. Product line is built to be the
   * strongest signal in the file, so at minimum it survives.
   */
  it("prices the leads on what they asked for", () => {
    const included = result.valueModel.includedFactors.map((f) => f.key);
    expect(included).toContain("product_line");
    expect(result.valueModel.isFlat).toBe(false);

    const valued = valueAllLeads(mapped.deals, result.valueModel);
    const values = new Set(valued.map((v) => Math.round(v.value)));
    expect(values.size).toBeGreaterThan(3);
  });

  it("finds the quote step as an early gate that fires inside the window", () => {
    expect(result.earlyGate.candidates.length).toBeGreaterThan(0);
  });

  /*
   * Frozen and reloaded, the model still knows it prices consumers and
   * rebuilds its rules without the business factors. A model that forgot its
   * audience on the way through JSON would come back with four inert rules
   * and a warning about columns the file never had.
   */
  it("keeps its audience through save and load", () => {
    const saved = saveValueModel(result.valueModel, { deals: mapped.deals });
    expect(saved.audience).toBe("b2c");
    const back = loadSavedModel(JSON.parse(JSON.stringify(saved)));
    expect(back.model?.audience).toBe("b2c");
    const rebuilt = savedModelToValueModel(back.model!);
    expect(rebuilt.audience).toBe("b2c");
    expect(rebuilt.factors.map((f) => f.key)).toContain("product_line");
  });
});
