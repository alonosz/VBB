import { describe, expect, it } from "vitest";
import { detectColumns, detectStageTimingColumns } from "@/lib/mapping/detect";
import { discoverSignalColumns, signalColumnsFor } from "@/lib/mapping/signals";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic } from "@/lib/analysis";
import { generateConsumerDemoRows } from "@/lib/fixtures/consumerDataset";
import { demoDealsToCsvRows, generateDemoDeals } from "@/lib/fixtures/demoDataset";
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
   * The sample is a designed artifact, not just some rows. Each of these was
   * broken at some point while building it: the value cap was three times a
   * median that renters dragged down, so bundle, life and commercial priced
   * identically at the cap and the most valuable product came out cheaper
   * than the second. It read as a bug and hid the thing the file exists to
   * show. These lock the shape rather than the numbers.
   */
  it("caps a handful of deals rather than a whole segment", () => {
    expect(result.valueSpread.dealsAboveCap).toBeGreaterThan(0);
    expect(result.valueSpread.dealsAboveCap).toBeLessThan(25);

    /*
     * No level we actually price on may sit entirely above the cap. When it
     * does, every deal in it is clipped to the same figure, the segment's
     * value disappears and the ladder inverts. Commercial is the exception
     * and is allowed to be: a fleet policy really is more than three times a
     * personal one, and with thirteen quotes behind it the engine marks it
     * unusable and never prices on it anyway.
     */
    const products = result.valueModel.factors.find((f) => f.key === "product_line");
    const cap = result.valueModel.cap;
    const pinned = (products?.levels ?? [])
      .filter((l) => l.usable && l.won > 0 && l.avgWonAmount === cap)
      .map((l) => l.level);
    expect(pinned).toEqual([]);
  });

  it("keeps the signals that carry value and drops the one that does not", () => {
    const included = result.valueModel.includedFactors.map((f) => f.key);
    expect(included).toEqual(
      expect.arrayContaining(["product_line", "coverage_tier", "timeline", "currently_insured", "state"])
    );
    // A pure A/B split with no effect on anything. If this ever survives, the
    // lift threshold has stopped doing its job.
    expect(result.valueModel.droppedFactors.map((f) => f.key)).toContain("form_variant");
  });

  it("catches the stage that was dragged through retroactively", () => {
    expect(result.stageTrust.untrustedStages).toEqual(["Application"]);
    const quoted = result.stageTrust.findings.find((f) => f.stage === "Quoted");
    expect(quoted?.trusted).toBe(true);
  });

  it("prices renters below auto despite renters converting far better", () => {
    const products = result.valueModel.factors.find((f) => f.key === "product_line");
    const level = (n: string) => products?.levels.find((l) => l.level === n);
    const renters = level("Renters");
    const auto = level("Auto");
    expect(renters!.closeRate).toBeGreaterThan(auto!.closeRate * 1.3);
    expect(renters!.expectedValue).toBeLessThan(auto!.expectedValue * 0.7);
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

/*
 * The report behind the screenshot: 500 software deals, run as a consumer.
 * Headcount, industry and title were dropped as factors, discovery skipped
 * those columns because the fields still claimed them, and every lead was
 * priced at the average. The hero then presented "$2,195 - $2,195 per lead"
 * as what the model would send instead. Under a consumer the company columns
 * go back to discovery and the file is priced on whatever they carry.
 */
describe("a business file, run as a consumer", () => {
  const rows = demoDealsToCsvRows(generateDemoDeals());
  const headers = Object.keys(rows[0]);
  const { fields } = detectColumns(headers, rows);
  const stageTiming = detectStageTimingColumns(headers, rows);

  it("was priced flat when the company columns stayed claimed", () => {
    const { discovered } = discoverSignalColumns(headers, rows, fields, "b2b");
    expect(discovered.map((d) => d.column)).not.toContain("industry");
  });

  it("is priced on the company columns as plain categories instead", () => {
    const { discovered } = discoverSignalColumns(headers, rows, fields, "b2c");
    const customSignalKeys = signalColumnsFor([], discovered);
    expect(customSignalKeys).toContain("industry");

    const mapped = rowsToDeals({ rows, fields, stageTiming, signalColumns: customSignalKeys });
    const result = runDiagnostic({
      deals: mapped.deals,
      excluded: mapped.excluded,
      currencyCode: "USD",
      customSignalKeys,
      audience: "b2c",
      businessContext: "We sell to mid-market logistics and manufacturing companies.",
      now: new Date("2026-09-05T00:00:00Z"),
    });
    expect(result.valueModel.isFlat).toBe(false);
    expect(result.valueModel.factors.map((f) => f.key)).not.toContain("employeeBand");

    // A consumer has no ideal customer profile to hold the data against,
    // however many industries the description happens to name.
    expect(result.icpFit.available).toBe(false);
  });
});
