import { describe, expect, it } from "vitest";
import {
  MAX_LISTED,
  deriveOutcome,
  outcomeKey,
  outcomeVocabulary,
  readOutcome,
} from "./outcomes";

describe("the built-in reading", () => {
  it("knows the words a consumer business uses for a sale", () => {
    for (const w of ["Bound", "Funded", "Enrolled", "Converted", "Paid", "Purchased", "Subscribed"]) {
      expect(deriveOutcome(w, undefined), w).toBe("won");
    }
  });

  it("knows the words for a lead that is gone", () => {
    for (const w of ["Declined", "Cancelled", "Canceled", "Unqualified", "Not interested", "No-show", "No show", "Withdrawn", "Denied", "Spam", "Duplicate"]) {
      expect(deriveOutcome(w, undefined), w).toBe("lost");
    }
  });

  /*
   * Each of these names a step before the sale in at least one vertical. A
   * step read as a sale inflates every close rate, so they stay open until
   * the advertiser says otherwise.
   */
  it("does not read a step before the sale as the sale", () => {
    for (const w of ["Approved", "Signed", "Booked", "Active", "Quoted", "Application"]) {
      expect(deriveOutcome(w, undefined), w).toBe("open");
    }
  });

  it("still reads lost before won when a value carries both", () => {
    expect(deriveOutcome("Purchase cancelled", undefined)).toBe("lost");
  });
});

describe("the advertiser's reading", () => {
  it("wins over the built-in list on the exact value", () => {
    expect(readOutcome("Policy issued", undefined, { "policy issued": "won" })).toBe("won");
    expect(readOutcome("Won", undefined, { won: "open" })).toBe("open");
  });

  it("matches however the value is capitalised or padded", () => {
    expect(outcomeKey("  Policy Issued ")).toBe("policy issued");
    expect(readOutcome("  POLICY ISSUED", undefined, { "policy issued": "won" })).toBe("won");
  });

  it("leaves every other value to the built-in list", () => {
    expect(readOutcome("Declined", undefined, { "policy issued": "won" })).toBe("lost");
    expect(readOutcome("Quoted", undefined, { "policy issued": "won" })).toBe("open");
  });

  it("reads the outcome value before the stage value, like the built-in list", () => {
    expect(readOutcome("Issued", "Lost", { issued: "won" })).toBe("won");
  });
});

describe("the vocabulary shown on the mapping screen", () => {
  const rows = [
    ...Array(30).fill({ status: "Policy issued", stage: "Bound" }),
    ...Array(50).fill({ status: "Not taken up", stage: "Quoted" }),
    ...Array(20).fill({ status: "", stage: "New" }),
    ...Array(5).fill({ status: "policy issued", stage: "Bound" }),
  ];

  it("lists the outcome column's values most common first, with our reading", () => {
    const v = outcomeVocabulary(rows, "status", "stage")!;
    expect(v.column).toBe("status");
    expect(v.values.map((x) => [x.value, x.count, x.read])).toEqual([
      ["Not taken up", 50, "open"],
      ["Policy issued", 35, "open"],
    ]);
    // The whole file read as open: the case the alert on screen exists for.
    expect(v.won).toBe(0);
    expect(v.open).toBe(85);
  });

  it("falls back to the stage column when no outcome column is mapped", () => {
    const v = outcomeVocabulary(rows, null, "stage")!;
    expect(v.column).toBe("stage");
    expect(v.values.find((x) => x.value === "Bound")?.read).toBe("won");
    expect(v.won).toBe(35);
  });

  it("shows the advertiser's correction and remembers the rule behind it", () => {
    const v = outcomeVocabulary(rows, "status", "stage", {
      "policy issued": "won",
      "not taken up": "lost",
    })!;
    const issued = v.values.find((x) => x.value === "Policy issued")!;
    expect(issued.read).toBe("won");
    expect(issued.rule).toBe("open");
    expect(issued.by).toBe("you");
    expect(v.won).toBe(35);
    expect(v.lost).toBe(50);
    expect(v.open).toBe(0);
  });

  it("is nothing when neither column is mapped", () => {
    expect(outcomeVocabulary(rows, null, null)).toBeNull();
  });

  it("stops listing past the point where a column is not a status", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ status: `note ${i}` }));
    const v = outcomeVocabulary(many, "status", null)!;
    expect(v.values).toHaveLength(MAX_LISTED);
    expect(v.more).toBe(200 - MAX_LISTED);
  });
});
