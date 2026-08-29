import { describe, expect, it } from "vitest";
import {
  detectColumns,
  detectStageTimingColumns,
  findFileIssues,
  looksLikeClickId,
  looksLikeDate,
  looksNumeric,
} from "./detect";
import { deriveOutcome, rowsToDeals } from "./toDeals";
import { generateDemoDeals, demoDealsToCsvRows } from "@/lib/fixtures/demoDataset";

const HUBSPOT_ROWS: Record<string, string>[] = [
  {
    record_id: "1", created_at: "2026-01-02", close_date: "2026-01-08",
    dealstage: "Closed Won", amount__c: "8500", deal_currency: "USD",
    lead_source: "Webinar", contact_email: "a@acme.com", gclid_c: "Cj0KCQiA1234567890abcdef",
  },
  {
    record_id: "2", created_at: "2026-01-03", close_date: "",
    dealstage: "Qualified", amount__c: "1200", deal_currency: "USD",
    lead_source: "Paid Search", contact_email: "b@gmail.com", gclid_c: "",
  },
  {
    record_id: "3", created_at: "2026-01-05", close_date: "2026-01-20",
    dealstage: "Closed Lost", amount__c: "", deal_currency: "USD",
    lead_source: "Paid Social", contact_email: "c@corp.io", gclid_c: "",
  },
];

const HEADERS = Object.keys(HUBSPOT_ROWS[0]);

// ---------------------------------------------------------------------------
// Value pattern tests
// ---------------------------------------------------------------------------

describe("value pattern tests", () => {
  it("recognizes real dates but not bare integers", () => {
    expect(looksLikeDate("2026-01-02")).toBe(true);
    expect(looksLikeDate("Jan 2, 2026")).toBe(true);
    // A record ID or a year must never be mistaken for a date column.
    expect(looksLikeDate("2024")).toBe(false);
    expect(looksLikeDate("88123")).toBe(false);
    expect(looksLikeDate("")).toBe(false);
  });

  it("recognizes numbers with currency symbols and separators", () => {
    expect(looksNumeric("8500")).toBe(true);
    expect(looksNumeric("$8,500.00")).toBe(true);
    expect(looksNumeric("£1 200")).toBe(true);
    expect(looksNumeric("n/a")).toBe(false);
  });

  it("recognizes a Google click ID by shape, not by header", () => {
    expect(looksLikeClickId("Cj0KCQiA1234567890abcdef")).toBe(true);
    expect(looksLikeClickId("short")).toBe(false);
    expect(looksLikeClickId("has spaces in it here")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectColumns
// ---------------------------------------------------------------------------

describe("detectColumns", () => {
  const { fields, unmapped } = detectColumns(HEADERS, HUBSPOT_ROWS);
  const byKey = (k: string) => fields.find((f) => f.key === k)!;

  it("maps the core fields from a HubSpot-style export", () => {
    expect(byKey("createdAt").column).toBe("created_at");
    expect(byKey("closedAt").column).toBe("close_date");
    expect(byKey("amount").column).toBe("amount__c");
    expect(byKey("stage").column).toBe("dealstage");
    expect(byKey("source").column).toBe("lead_source");
    expect(byKey("email").column).toBe("contact_email");
    expect(byKey("clickId").column).toBe("gclid_c");
    expect(byKey("currency").column).toBe("deal_currency");
  });

  it("never assigns one column to two different fields", () => {
    const claimed = fields.map((f) => f.column).filter(Boolean);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it("does not map record_id to a date field despite numeric content", () => {
    expect(byKey("createdAt").column).not.toBe("record_id");
    expect(unmapped).toContain("record_id");
  });

  it("explains its reasoning in plain English", () => {
    const created = byKey("createdAt");
    expect(created.reason).toMatch(/parse as dates/);
    expect(created.confidence).toBeGreaterThan(0.8);
  });

  it("lists distinct values for low-cardinality fields", () => {
    expect(byKey("stage").sampleValues).toContain("Closed Won");
    expect(byKey("source").sampleValues).toContain("Webinar");
  });

  it("leaves optional firmographic fields unmapped when absent", () => {
    expect(byKey("employeeCount").column).toBeNull();
    expect(byKey("industry").confidence).toBeNull();
  });

  it("rejects a header hint whose values contradict it", () => {
    const rows = [{ close_date: "banana" }, { close_date: "not a date" }];
    const r = detectColumns(["close_date"], rows);
    expect(r.fields.find((f) => f.key === "closedAt")!.column).toBeNull();
  });

  it("handles an empty file without throwing", () => {
    const r = detectColumns([], []);
    expect(r.fields.every((f) => f.column === null)).toBe(true);
    expect(r.unmapped).toEqual([]);
  });

  it("prefers the lead's email over the sales rep's owner_email", () => {
    // owner_email is a valid email on every row, but it's one internal
    // address repeated - mapping it would report a fake 100% match rate.
    const rows = Array.from({ length: 20 }, (_, i) => ({
      created_at: "2026-01-01",
      contact_email: `lead${i}@customer${i}.com`,
      owner_email: "rep@vendor.com",
    }));
    const r = detectColumns(Object.keys(rows[0]), rows);
    expect(r.fields.find((f) => f.key === "email")!.column).toBe("contact_email");
  });

  it("rejects a repeated internal address even when it is the only email column", () => {
    const rows = Array.from({ length: 20 }, () => ({
      created_at: "2026-01-01",
      owner_email: "rep@vendor.com",
    }));
    const r = detectColumns(Object.keys(rows[0]), rows);
    const email = r.fields.find((f) => f.key === "email")!;
    // It may still be offered, but never with confidence that implies trust.
    if (email.column !== null) expect(email.confidence!).toBeLessThan(0.5);
  });

  it("detects a click ID column by token shape", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      created_at: "2026-01-01",
      gclid_c: i < 4 ? `Cj0KCQiA${"aB3xY7zQ".repeat(7)}${i}` : "",
    }));
    const r = detectColumns(Object.keys(rows[0]), rows);
    expect(r.fields.find((f) => f.key === "clickId")!.column).toBe("gclid_c");
  });

  it("maps the generated demo export end to end", () => {
    const rows = demoDealsToCsvRows(generateDemoDeals({ count: 40 }));
    const r = detectColumns(Object.keys(rows[0]), rows);
    const k = (key: string) => r.fields.find((f) => f.key === key)!.column;
    expect(k("createdAt")).toBe("created_at");
    expect(k("amount")).toBe("amount__c");
    expect(k("source")).toBe("lead_source");
    expect(k("employeeCount")).toBe("employee_count");
    expect(k("industry")).toBe("industry");
    expect(k("contactTitle")).toBe("contact_title");
    // The demo carries both a lead email and a rep email; pick the lead's.
    expect(k("email")).toBe("contact_email");
    expect(k("clickId")).toBe("gclid_c");
  });
});

// ---------------------------------------------------------------------------
// findFileIssues
// ---------------------------------------------------------------------------

describe("findFileIssues", () => {
  it("flags mixed currency with per-code counts", () => {
    const rows = [
      { amount__c: "100", deal_currency: "USD", created_at: "2026-01-01" },
      { amount__c: "200", deal_currency: "USD", created_at: "2026-01-02" },
      { amount__c: "300", deal_currency: "GBP", created_at: "2026-01-03" },
    ];
    const { fields } = detectColumns(Object.keys(rows[0]), rows);
    const issues = findFileIssues(rows, fields);
    const cur = issues.find((i) => i.kind === "mixed_currency")!;
    expect(cur.count).toBe(1);
    expect(cur.detail).toMatch(/USD 2/);
    expect(cur.detail).toMatch(/GBP 1/);
  });

  it("reports missing amounts and create dates separately", () => {
    const { fields } = detectColumns(HEADERS, HUBSPOT_ROWS);
    const issues = findFileIssues(HUBSPOT_ROWS, fields);
    const missing = issues.filter((i) => i.kind === "missing_value");
    expect(missing).toHaveLength(1);
    expect(missing[0].title).toMatch(/no deal amount/);
    expect(missing[0].count).toBe(1);
    expect(missing[0].rowIndices).toEqual([2]);
  });

  it("detects exact duplicate rows", () => {
    const rows = [HUBSPOT_ROWS[0], HUBSPOT_ROWS[0], HUBSPOT_ROWS[1]];
    const { fields } = detectColumns(HEADERS, rows);
    const dupes = findFileIssues(rows, fields).find((i) => i.kind === "duplicates")!;
    expect(dupes.count).toBe(1);
  });

  it("raises a tracking gap below 40% identifier coverage", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      created_at: "2026-01-01",
      amount__c: "100",
      contact_email: i < 2 ? `p${i}@acme.com` : "",
      gclid_c: "",
    }));
    const { fields } = detectColumns(Object.keys(rows[0]), rows);
    const gap = findFileIssues(rows, fields).find((i) => i.kind === "low_identifiers")!;
    expect(gap.title).toMatch(/20%/);
    expect(gap.severity).toBe("warn");
  });

  it("stays quiet when coverage is healthy", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      created_at: "2026-01-01", amount__c: "100", contact_email: `p${i}@acme.com`,
    }));
    const { fields } = detectColumns(Object.keys(rows[0]), rows);
    expect(findFileIssues(rows, fields).some((i) => i.kind === "low_identifiers")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage timing - feeds the trust check and early-gate detection
// ---------------------------------------------------------------------------

describe("detectStageTimingColumns", () => {
  it("recognizes duration columns and their stage name", () => {
    const rows = [{ time_in_stage_qualified: "86400", time_in_stage_proposal: "9" }];
    const cols = detectStageTimingColumns(Object.keys(rows[0]), rows);
    expect(cols).toHaveLength(2);
    expect(cols[0]).toMatchObject({ stage: "Qualified", kind: "duration", unit: "seconds" });
    expect(cols[1].stage).toBe("Proposal");
  });

  it("recognizes entered-date columns", () => {
    const rows = [{ date_entered_qualified: "2026-01-05" }];
    const cols = detectStageTimingColumns(Object.keys(rows[0]), rows);
    expect(cols[0]).toMatchObject({ stage: "Qualified", kind: "entered" });
  });

  it("reads a days-based duration column in days, not seconds", () => {
    const rows = [{ days_in_stage_proposal: "4" }];
    const cols = detectStageTimingColumns(Object.keys(rows[0]), rows);
    expect(cols[0].unit).toBe("days");
  });

  it("ignores a column that matches the name pattern but holds text", () => {
    const rows = [{ time_in_stage_owner: "Alice" }, { time_in_stage_owner: "Bob" }];
    expect(detectStageTimingColumns(Object.keys(rows[0]), rows)).toHaveLength(0);
  });

  it("finds both shapes in the generated demo export", () => {
    const rows = demoDealsToCsvRows(generateDemoDeals({ count: 40 }));
    const cols = detectStageTimingColumns(Object.keys(rows[0]), rows);
    expect(cols.some((c) => c.kind === "duration")).toBe(true);
    expect(cols.some((c) => c.kind === "entered")).toBe(true);
  });
});

describe("rowsToDeals with stage timing", () => {
  it("carries durations through as seconds and entered-dates as days since creation", () => {
    const rows = [
      {
        created_at: "2026-01-01",
        amount__c: "1000",
        time_in_stage_qualified: "9",
        date_entered_qualified: "2026-01-04",
      },
    ];
    const { fields } = detectColumns(Object.keys(rows[0]), rows);
    const stageTiming = detectStageTimingColumns(Object.keys(rows[0]), rows);
    const { deals } = rowsToDeals({ rows, fields, stageTiming });

    expect(deals[0].stageDurations).toEqual({ Qualified: 9 });
    expect(deals[0].stageReachedAfterDays!.Qualified).toBeCloseTo(3, 5);
  });

  it("omits a stage rather than recording day zero when the cell is blank", () => {
    const rows = [{ created_at: "2026-01-01", date_entered_qualified: "" }];
    const { fields } = detectColumns(Object.keys(rows[0]), rows);
    const stageTiming = [
      { column: "date_entered_qualified", stage: "Qualified", kind: "entered" as const },
    ];
    const { deals } = rowsToDeals({ rows, fields, stageTiming });
    expect(deals[0].stageReachedAfterDays).toBeUndefined();
  });

  it("drops a stage reached before the lead existed as bad data", () => {
    const rows = [{ created_at: "2026-01-10", date_entered_qualified: "2026-01-01" }];
    const { fields } = detectColumns(Object.keys(rows[0]), rows);
    const stageTiming = [
      { column: "date_entered_qualified", stage: "Qualified", kind: "entered" as const },
    ];
    const { deals } = rowsToDeals({ rows, fields, stageTiming });
    expect(deals[0].stageReachedAfterDays).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deriveOutcome
// ---------------------------------------------------------------------------

describe("deriveOutcome", () => {
  it("reads won and lost from a stage name", () => {
    expect(deriveOutcome(undefined, "Closed Won")).toBe("won");
    expect(deriveOutcome(undefined, "Closed Lost")).toBe("lost");
  });

  it("treats an unrecognized stage as open rather than guessing", () => {
    expect(deriveOutcome(undefined, "Proposal")).toBe("open");
    expect(deriveOutcome(undefined, "")).toBe("open");
    expect(deriveOutcome(undefined, undefined)).toBe("open");
  });

  it("does not read 'Closed Lost' as won on the substring 'closed'", () => {
    expect(deriveOutcome("Closed Lost", "Closed Lost")).toBe("lost");
  });

  it("prefers an explicit outcome column over the stage", () => {
    expect(deriveOutcome("Lost", "Closed Won")).toBe("lost");
  });
});

// ---------------------------------------------------------------------------
// rowsToDeals
// ---------------------------------------------------------------------------

describe("rowsToDeals", () => {
  const { fields } = detectColumns(HEADERS, HUBSPOT_ROWS);

  it("maps rows into normalized deals", () => {
    const { deals } = rowsToDeals({ rows: HUBSPOT_ROWS, fields });
    expect(deals).toHaveLength(3);
    expect(deals[0].outcome).toBe("won");
    expect(deals[0].amount).toBe(8500);
    expect(deals[0].source).toBe("Webinar");
    expect(deals[0].createdAt).toBeInstanceOf(Date);
    expect(deals[2].amount).toBeNull();
  });

  it("excludes rows with an unreadable create date, with a reason", () => {
    const rows = [...HUBSPOT_ROWS, { ...HUBSPOT_ROWS[0], record_id: "4", created_at: "" }];
    const { deals, excluded } = rowsToDeals({ rows, fields });
    expect(deals).toHaveLength(3);
    expect(excluded[0].reason).toMatch(/Missing create date/);
  });

  it("drops duplicates and says so", () => {
    const rows = [HUBSPOT_ROWS[0], HUBSPOT_ROWS[0]];
    const { deals, excluded } = rowsToDeals({ rows, fields });
    expect(deals).toHaveLength(1);
    expect(excluded[0].reason).toMatch(/duplicate/i);
  });

  it("converts a foreign-currency amount at the given rate", () => {
    const rows = [{ ...HUBSPOT_ROWS[0], deal_currency: "GBP", amount__c: "1000" }];
    const { deals } = rowsToDeals({
      rows,
      fields,
      currency: { reportingCurrency: "USD", rates: { GBP: 1.27 }, excludeUnconvertible: true },
    });
    expect(deals[0].amount).toBe(1270);
  });

  it("excludes a row whose currency has no rate rather than treating it as 1:1", () => {
    const rows = [{ ...HUBSPOT_ROWS[0], deal_currency: "JPY", amount__c: "100000" }];
    const { deals, excluded } = rowsToDeals({
      rows,
      fields,
      currency: { reportingCurrency: "USD", rates: {}, excludeUnconvertible: true },
    });
    expect(deals).toHaveLength(0);
    expect(excluded[0].reason).toMatch(/JPY/);
  });

  it("nulls an unconvertible amount when not excluding, never assuming parity", () => {
    const rows = [{ ...HUBSPOT_ROWS[0], deal_currency: "JPY", amount__c: "100000" }];
    const { deals } = rowsToDeals({
      rows,
      fields,
      currency: { reportingCurrency: "USD", rates: {}, excludeUnconvertible: false },
    });
    expect(deals[0].amount).toBeNull();
  });

  it("strips currency symbols and separators from amounts", () => {
    const rows = [{ ...HUBSPOT_ROWS[0], amount__c: "$12,345.67" }];
    const { deals } = rowsToDeals({ rows, fields });
    expect(deals[0].amount).toBeCloseTo(12345.67, 2);
  });

  it("handles an empty file", () => {
    const { deals, excluded } = rowsToDeals({ rows: [], fields });
    expect(deals).toEqual([]);
    expect(excluded).toEqual([]);
  });
});

describe("rowsToDeals signal columns", () => {
  const { fields } = detectColumns(HEADERS, HUBSPOT_ROWS);

  it("carries the columns the user pointed at onto each deal", () => {
    const rows = [{ ...HUBSPOT_ROWS[0], budget_band: "50k+" }];
    const { deals } = rowsToDeals({ rows, fields, signalColumns: ["budget_band"] });
    expect(deals[0].signals).toEqual({ budget_band: "50k+" });
  });

  it("leaves a blank cell out rather than making it a level called nothing", () => {
    const rows = [{ ...HUBSPOT_ROWS[0], budget_band: "   " }];
    const { deals } = rowsToDeals({ rows, fields, signalColumns: ["budget_band"] });
    expect(deals[0].signals).toBeUndefined();
  });

  it("carries nothing when no signal columns were asked for", () => {
    const { deals } = rowsToDeals({ rows: HUBSPOT_ROWS, fields });
    expect(deals[0].signals).toBeUndefined();
  });
});
