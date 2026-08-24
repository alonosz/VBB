import { describe, expect, it } from "vitest";
import { profileColumns } from "./profile";
import { sanitizeProposal, EMPTY_PROPOSAL, type IntakeProposal } from "./proposal";
import { applyProposal, resolveHypotheses, HEURISTIC_TRUST_FLOOR } from "./merge";
import { buildIntakeUserMessage } from "./prompt";
import type { DetectedField } from "@/lib/mapping/detect";

// ---------------------------------------------------------------------------
// Column profiling — what leaves the machine
// ---------------------------------------------------------------------------

const ROWS = [
  { "Create Date": "2026-01-04", "Contact Email": "alice@acme.com", Stage: "Qualified", Amount: "14500.00", "Company Size": "420", Notes: "wants a demo next tuesday", GCLID: "Cj0KCQiA1" + "x".repeat(70) },
  { "Create Date": "2026-01-09", "Contact Email": "bob@globex.com", Stage: "Closed Won", Amount: "9200.50", "Company Size": "88", Notes: "budget approved by finance", GCLID: "Cj0KCQiA2" + "y".repeat(70) },
  { "Create Date": "2026-02-02", "Contact Email": "carla@initech.io", Stage: "Qualified", Amount: "31000.00", "Company Size": "1500", Notes: "referred by an existing customer", GCLID: "Cj0KCQiA3" + "z".repeat(70) },
];

describe("profileColumns", () => {
  const profiles = profileColumns(Object.keys(ROWS[0]), ROWS);
  const by = (name: string) => profiles.find((p) => p.name === name)!;
  const payload = JSON.stringify(profiles);

  it("classifies each column by the shape of its values", () => {
    expect(by("Create Date").kind).toBe("date");
    expect(by("Contact Email").kind).toBe("email");
    expect(by("Amount").kind).toBe("number");
    expect(by("Stage").kind).toBe("categorical");
    expect(by("Company Size").kind).toBe("number");
  });

  it("never carries an email address off the machine", () => {
    expect(payload).not.toMatch(/alice@acme\.com/);
    expect(by("Contact Email").exampleValues).toBeUndefined();
    expect(by("Contact Email").withheld).toBeTruthy();
  });

  it("never carries a click ID", () => {
    expect(payload).not.toMatch(/Cj0KCQiA/);
    expect(by("GCLID").exampleValues).toBeUndefined();
  });

  it("never carries a deal amount, not even as a range", () => {
    expect(payload).not.toMatch(/14500/);
    expect(payload).not.toMatch(/31000/);
    // Digit counts are enough to tell an amount column from a headcount one.
    expect(by("Amount").numericShape).toEqual({ minDigits: 4, maxDigits: 5, hasDecimals: true });
  });

  it("never carries free-text notes", () => {
    expect(payload).not.toMatch(/budget approved/);
    expect(by("Notes").withheld).toBeTruthy();
  });

  it("does carry short category labels, which is the whole mapping signal", () => {
    expect(by("Stage").exampleValues).toEqual(
      expect.arrayContaining(["Qualified", "Closed Won"])
    );
  });

  it("withholds values from any column whose header names a person or a company", () => {
    const p = profileColumns(["Contact Name", "Company"], [
      { "Contact Name": "Dana Reed", Company: "Initech" },
      { "Contact Name": "Ravi Patel", Company: "Globex" },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/Dana Reed|Initech/);
    expect(p.every((c) => c.withheld)).toBe(true);
  });

  it("reports fill rate and cardinality, which is how a create date is told from a close date", () => {
    const p = profileColumns(["Close Date"], [
      { "Close Date": "2026-03-01" },
      { "Close Date": "" },
      { "Close Date": "" },
    ]);
    expect(p[0].fillRate).toBeCloseTo(0.33, 2);
  });
});

describe("buildIntakeUserMessage", () => {
  it("sends only the profiles, never a row", () => {
    const msg = buildIntakeUserMessage("we sell to manufacturers", profileColumns(Object.keys(ROWS[0]), ROWS));
    expect(msg).toMatch(/we sell to manufacturers/);
    expect(msg).toMatch(/"Create Date"/);
    expect(msg).not.toMatch(/alice@acme\.com/);
    expect(msg).not.toMatch(/14500/);
  });
});

// ---------------------------------------------------------------------------
// Sanitizing — model output is untrusted input
// ---------------------------------------------------------------------------

const HEADERS = ["Create Date", "Amount", "Contact Job Title", "Company Size", "Deal Source"];

describe("sanitizeProposal", () => {
  it("drops a mapping to a column that is not in the file", () => {
    const p = sanitizeProposal(
      { columnMapping: [{ field: "createdAt", column: "Invented Column", why: "x" }] },
      HEADERS
    );
    expect(p.columnMapping).toEqual([]);
  });

  it("drops a field key we do not have", () => {
    const p = sanitizeProposal(
      { columnMapping: [{ field: "leadScore", column: "Amount", why: "x" }] },
      HEADERS
    );
    expect(p.columnMapping).toEqual([]);
  });

  it("lets one column be claimed by one field only", () => {
    const p = sanitizeProposal(
      {
        columnMapping: [
          { field: "amount", column: "Amount", why: "a" },
          { field: "employeeCount", column: "Amount", why: "b" },
        ],
      },
      HEADERS
    );
    expect(p.columnMapping).toHaveLength(1);
    expect(p.columnMapping[0].field).toBe("amount");
  });

  it("drops a candidate factor pointing at a column that does not exist", () => {
    const p = sanitizeProposal(
      { candidateFactors: [{ column: "Nope", statedLevels: ["a"], userClaim: "c" }] },
      HEADERS
    );
    expect(p.candidateFactors).toEqual([]);
  });

  it("keeps a candidate factor pointing at a real column", () => {
    const p = sanitizeProposal(
      {
        candidateFactors: [
          { column: "Contact Job Title", statedLevels: ["Director", "VP"], userClaim: "buyers are ops directors" },
        ],
      },
      HEADERS
    );
    expect(p.candidateFactors).toEqual([
      { column: "Contact Job Title", statedLevels: ["Director", "VP"], userClaim: "buyers are ops directors" },
    ]);
  });

  it("rights a reversed range rather than trusting it", () => {
    const p = sanitizeProposal(
      { statedCycleDaysMin: 90, statedCycleDaysMax: 60 },
      HEADERS
    );
    expect(p.statedCycleDaysMin).toBe(60);
    expect(p.statedCycleDaysMax).toBe(90);
  });

  it("refuses nonsense numbers", () => {
    const p = sanitizeProposal(
      { statedCycleDaysMin: -4, statedLeadsPerMonthMin: Number.POSITIVE_INFINITY },
      HEADERS
    );
    expect(p.statedCycleDaysMin).toBeNull();
    expect(p.statedLeadsPerMonthMin).toBeNull();
  });

  it("returns the empty proposal for anything that is not an object", () => {
    expect(sanitizeProposal("nope", HEADERS)).toEqual(EMPTY_PROPOSAL);
    expect(sanitizeProposal(null, HEADERS)).toEqual(EMPTY_PROPOSAL);
  });
});

// ---------------------------------------------------------------------------
// Merging — heuristics measured the values, the assistant read the sentence
// ---------------------------------------------------------------------------

function field(p: Partial<DetectedField> & { key: DetectedField["key"] }): DetectedField {
  return {
    label: p.key,
    hint: "",
    required: false,
    column: null,
    confidence: null,
    reason: null,
    source: "heuristic",
    ...p,
  };
}

function proposal(over: Partial<IntakeProposal>): IntakeProposal {
  return { ...EMPTY_PROPOSAL, ...over };
}

describe("applyProposal", () => {
  it("fills a field the heuristics could not place", () => {
    const r = applyProposal(
      [field({ key: "contactTitle", label: "Contact title" })],
      proposal({ columnMapping: [{ field: "contactTitle", column: "Contact Job Title", why: "you described buyers by title" }] })
    );
    expect(r.fields[0].column).toBe("Contact Job Title");
    expect(r.fields[0].source).toBe("assistant");
    expect(r.applied).toEqual(["contactTitle"]);
  });

  it("never shows a confidence percentage for a suggestion", () => {
    const r = applyProposal(
      [field({ key: "industry", label: "Industry" })],
      proposal({ columnMapping: [{ field: "industry", column: "Company Size", why: "x" }] })
    );
    expect(r.fields[0].confidence).toBeNull();
  });

  it("keeps a confident heuristic match and surfaces the disagreement instead", () => {
    const r = applyProposal(
      [field({ key: "amount", label: "Amount", column: "Amount", confidence: 0.95 })],
      proposal({ columnMapping: [{ field: "amount", column: "Company Size", why: "x" }] })
    );
    expect(r.fields[0].column).toBe("Amount");
    expect(r.fields[0].disagreement).toMatch(/Company Size/);
    expect(r.disagreed).toEqual(["amount"]);
  });

  it("overrides a weak heuristic match", () => {
    const weak = HEURISTIC_TRUST_FLOOR - 0.2;
    const r = applyProposal(
      [field({ key: "industry", label: "Industry", column: "Deal Source", confidence: weak })],
      proposal({ columnMapping: [{ field: "industry", column: "Company Size", why: "x" }] })
    );
    expect(r.fields[0].column).toBe("Company Size");
  });

  it("never takes a column another field is confidently holding", () => {
    const r = applyProposal(
      [
        field({ key: "amount", label: "Amount", column: "Amount", confidence: 0.95 }),
        field({ key: "employeeCount", label: "Employees" }),
      ],
      proposal({ columnMapping: [{ field: "employeeCount", column: "Amount", why: "x" }] })
    );
    expect(r.fields[1].column).toBeNull();
    expect(r.fields[1].disagreement).toMatch(/Amount/);
  });

  it("frees a column held only weakly, and says why it moved", () => {
    const r = applyProposal(
      [
        field({ key: "industry", label: "Industry", column: "Company Size", confidence: 0.4 }),
        field({ key: "employeeCount", label: "Employees" }),
      ],
      proposal({ columnMapping: [{ field: "employeeCount", column: "Company Size", why: "headcount" }] })
    );
    expect(r.fields[0].column).toBeNull();
    expect(r.fields[0].reason).toMatch(/Employees/);
    expect(r.fields[1].column).toBe("Company Size");
  });

  it("leaves a user's own choice alone", () => {
    const r = applyProposal(
      [field({ key: "amount", label: "Amount", column: "Amount", confidence: 1, source: "user" })],
      proposal({ columnMapping: [{ field: "amount", column: "Company Size", why: "x" }] })
    );
    expect(r.fields[0].column).toBe("Amount");
    expect(r.fields[0].source).toBe("user");
  });

  it("says so when the two agree", () => {
    const r = applyProposal(
      [field({ key: "amount", label: "Amount", column: "Amount", confidence: 0.95, reason: "Values are numeric" })],
      proposal({ columnMapping: [{ field: "amount", column: "Amount", why: "x" }] })
    );
    expect(r.fields[0].reason).toMatch(/your description agrees/);
    expect(r.disagreed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hypotheses — claims become factors the engine already knows how to fit
// ---------------------------------------------------------------------------

describe("resolveHypotheses", () => {
  const fields = [
    field({ key: "contactTitle", label: "Contact title", column: "Contact Job Title" }),
    field({ key: "employeeCount", label: "Employees", column: "Company Size" }),
    field({ key: "source", label: "Lead source", column: "Deal Source" }),
    field({ key: "amount", label: "Amount", column: "Amount" }),
  ];

  it("routes a title claim onto the seniority factor rather than adding a duplicate", () => {
    const r = resolveHypotheses(
      proposal({ candidateFactors: [{ column: "Contact Job Title", statedLevels: ["Director"], userClaim: "ops directors buy" }] }),
      fields
    );
    expect(r.hypotheses[0].factorKey).toBe("seniority");
    expect(r.customSignalKeys).toEqual([]);
  });

  it("routes a headcount claim onto the employee band factor", () => {
    const r = resolveHypotheses(
      proposal({ candidateFactors: [{ column: "Company Size", statedLevels: ["201-1000"], userClaim: "mid-market" }] }),
      fields
    );
    expect(r.hypotheses[0].factorKey).toBe("employeeBand");
  });

  it("makes an unmapped column a new custom signal", () => {
    const r = resolveHypotheses(
      proposal({ candidateFactors: [{ column: "Budget Band", statedLevels: ["50k+"], userClaim: "big budgets close" }] }),
      [...fields, field({ key: "stage", label: "Stage" })]
    );
    expect(r.customSignalKeys).toEqual(["Budget Band"]);
    expect(r.hypotheses[0].factorKey).toBe("Budget Band");
  });

  it("refuses a claim about the source column", () => {
    // Every lead we price came from an ad click; the ad platform already knows
    // which campaign produced it.
    const r = resolveHypotheses(
      proposal({ candidateFactors: [{ column: "Deal Source", statedLevels: ["Referral"], userClaim: "referrals close best" }] }),
      fields
    );
    expect(r.hypotheses).toEqual([]);
    expect(r.customSignalKeys).toEqual([]);
  });

  it("refuses a claim about a structural column like the amount", () => {
    const r = resolveHypotheses(
      proposal({ candidateFactors: [{ column: "Amount", statedLevels: ["big"], userClaim: "big deals are good" }] }),
      fields
    );
    expect(r.hypotheses).toEqual([]);
  });
});

describe("profileColumns date classification", () => {
  it("does not read a record ID as a date", () => {
    // Date.parse("demo-1042") happily returns a date in the year 1042.
    const p = profileColumns(["ref"], [
      { ref: "demo-1042" }, { ref: "demo-1043" }, { ref: "demo-1044" },
    ]);
    expect(p[0].kind).not.toBe("date");
    expect(p[0].dateSpanDays).toBeUndefined();
  });

  it("still reads real dates", () => {
    const p = profileColumns(["when"], [
      { when: "2026-01-04" }, { when: "2026-03-19T08:00:00Z" }, { when: "12/03/2026" },
    ]);
    expect(p[0].kind).toBe("date");
  });
});
