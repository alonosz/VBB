import { describe, expect, it } from "vitest";
describe("buildFactorList by audience", () => {
  it("keeps the four business factors for businesses", async () => {
    const { buildFactorList } = await import("./factors");
    const keys = buildFactorList(["Budget"], "b2b").map((f) => f.key);
    expect(keys).toEqual(["domainType", "employeeBand", "industry", "seniority", "Budget"]);
  });

  /*
   * A consumer has no headcount, industry or title, and every consumer is on
   * webmail. Fitting the business factors on that file finds nothing or finds
   * a one-level "Free webmail" rule, and either way the report carries lines
   * about signals that could never have applied.
   */
  it("drops them for consumers and keeps only what the file supplied", async () => {
    const { buildFactorList } = await import("./factors");
    expect(buildFactorList(["Case type"], "b2c").map((f) => f.key)).toEqual(["Case type"]);
  });

  it("reads as businesses when nobody said", async () => {
    const { buildFactorList } = await import("./factors");
    expect(buildFactorList([]).map((f) => f.key)).toContain("employeeBand");
  });
});
