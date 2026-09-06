import { describe, expect, it } from "vitest";
import { dealsToRows, HUBSPOT_HEADERS } from "./rows";
import { detectColumns, detectStageTimingColumns } from "@/lib/mapping/detect";
import { discoverSignalColumns } from "@/lib/mapping/signals";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import type { MappedDeal } from "@/lib/analysis/types";

/**
 * The round trip is the whole design, so it is the whole test.
 *
 * HubSpot produces MappedDeal, this flattens it to rows, the mapping screen
 * detects those rows, and the analysis turns them back into MappedDeal. If
 * anything is lost in that circle, a HubSpot customer gets a quietly worse
 * model than a CSV customer with the same data, and nothing would say so.
 */

let seq = 0;

/**
 * Distinct email and click ID per deal, because real ones are and the
 * detector requires it: a column repeating one value is an owner's address,
 * not the lead's. The click ID is a realistic length too - the detector wants
 * 20 characters or more, which every real gclid clears and a short
 * placeholder does not.
 */
function deal(over: Partial<MappedDeal> = {}): MappedDeal {
  const n = ++seq;
  return {
    id: `d${n}`,
    createdAt: new Date("2026-03-04T00:00:00Z"),
    closedAt: new Date("2026-04-18T00:00:00Z"),
    outcome: "won",
    amount: 18400,
    stage: "Closed Won",
    source: "Paid Search",
    email: `buyer${n}@northgate.example`,
    clickId: `Cj0KCQiAxOeqBhCrARIsAC0${n}TlSp7Kx9vQmZ2rWd4YfLb`,
    employeeCount: 240,
    industry: "Manufacturing",
    contactTitle: "Operations Director",
    ...over,
  };
}

/** What the mapping screen and the analysis would do with these rows. */
function throughTheFlow(deals: MappedDeal[]) {
  const { headers, rows } = dealsToRows(deals);
  const { fields } = detectColumns(headers, rows);
  return { headers, fields, ...rowsToDeals({ rows, fields }) };
}

describe("what the mapping screen sees", () => {
  it("detects every field, so the screen opens filled in rather than guessing", () => {
    const { fields } = throughTheFlow([
      deal(),
      deal({ outcome: "lost", stage: "Closed Lost", amount: null }),
      deal({ outcome: "open", stage: "Discovery", closedAt: null, amount: null }),
    ]);
    const mapped = (key: string) => fields.find((f) => f.key === key)?.column ?? null;

    expect(mapped("createdAt")).toBe(HUBSPOT_HEADERS.createdAt);
    expect(mapped("closedAt")).toBe(HUBSPOT_HEADERS.closedAt);
    expect(mapped("outcome")).toBe(HUBSPOT_HEADERS.outcome);
    expect(mapped("amount")).toBe(HUBSPOT_HEADERS.amount);
    expect(mapped("stage")).toBe(HUBSPOT_HEADERS.stage);
    expect(mapped("source")).toBe(HUBSPOT_HEADERS.source);
    expect(mapped("email")).toBe(HUBSPOT_HEADERS.email);
    expect(mapped("clickId")).toBe(HUBSPOT_HEADERS.clickId);
  });

  it("does not offer a column the portal never filled in", () => {
    // A portal with no click ID captured should be told it has none, not shown
    // a column that is present and 0% filled.
    const { headers } = dealsToRows([deal({ clickId: null }), deal({ clickId: null })]);
    expect(headers).not.toContain(HUBSPOT_HEADERS.clickId);
    expect(headers).toContain(HUBSPOT_HEADERS.email);
  });

  it("keeps a column that only some rows filled in", () => {
    const { headers } = dealsToRows([deal({ clickId: null }), deal()]);
    expect(headers).toContain(HUBSPOT_HEADERS.clickId);
  });
});

describe("the round trip", () => {
  it("returns every field the model reads, unchanged", () => {
    const original = deal();
    const { deals, excluded } = throughTheFlow([original]);

    expect(excluded).toHaveLength(0);
    expect(deals).toHaveLength(1);

    const back = deals[0];
    expect(back.createdAt?.toISOString().slice(0, 10)).toBe("2026-03-04");
    expect(back.closedAt?.toISOString().slice(0, 10)).toBe("2026-04-18");
    expect(back.outcome).toBe("won");
    expect(back.amount).toBe(18400);
    expect(back.stage).toBe("Closed Won");
    expect(back.source).toBe("Paid Search");
    expect(back.email).toBe(original.email);
    expect(back.clickId).toBe(original.clickId);
  });

  it("keeps won and lost apart, which is what every cohort is built from", () => {
    const { deals } = throughTheFlow([
      deal({ outcome: "won" }),
      deal({ outcome: "lost", stage: "Closed Lost", amount: null }),
      deal({ outcome: "open", stage: "Discovery", closedAt: null, amount: null }),
    ]);

    const outcomes = deals.map((d) => d.outcome).sort();
    expect(outcomes).toEqual(["lost", "open", "won"]);
  });

  it("does not invent an amount for a deal that has none", () => {
    const { deals } = throughTheFlow([deal({ amount: null })]);
    expect(deals[0].amount).toBeNull();
  });

  it("does not invent a close date for a deal still open", () => {
    const { deals } = throughTheFlow([
      deal({ outcome: "open", stage: "Discovery", closedAt: null, amount: null }),
    ]);
    expect(deals[0].closedAt).toBeNull();
    expect(deals[0].outcome).toBe("open");
  });

  it("carries the firmographics the ICP check needs", () => {
    const { deals } = throughTheFlow([deal()]);
    expect(deals[0].employeeCount).toBe(240);
    expect(deals[0].industry).toBe("Manufacturing");
    expect(deals[0].contactTitle).toBe("Operations Director");
  });

  it("survives a portal that captures almost nothing", () => {
    const bare: MappedDeal = {
      id: "d9",
      createdAt: new Date("2026-01-09T00:00:00Z"),
      closedAt: null,
      outcome: "open",
      amount: null,
      stage: "New",
      source: null,
      email: null,
      clickId: null,
    };
    const { deals, excluded } = throughTheFlow([bare]);
    expect(excluded).toHaveLength(0);
    expect(deals[0].stage).toBe("New");
    expect(deals[0].email).toBeNull();
  });

  it("produces something for an empty portal rather than a broken file", () => {
    const { headers, rows } = dealsToRows([]);
    expect(rows).toHaveLength(0);
    expect(headers).toEqual([HUBSPOT_HEADERS.id]);
  });
});

/*
 * What the portal knows beyond the fixed fields has to reach the mapping
 * screen the way a file's columns do, or a HubSpot customer gets no
 * discovered signals, no early gate and no trust check.
 */
describe("the portal's own columns", () => {
  const deals = Array.from({ length: 60 }, (_, i) =>
    deal({
      signals: { "Product line": ["Auto", "Home", "Renters"][i % 3], "Urgent?": i % 2 ? "Yes" : "No" },
      stageReachedAfterDays: { Quoted: 2 },
      stageDurations: { Quoted: 7200 },
    })
  );

  it("become columns, after the fixed ones, in a stable order", () => {
    const { headers } = dealsToRows(deals);
    const fixed = headers.filter((h) => (Object.values(HUBSPOT_HEADERS) as string[]).includes(h));
    expect(headers.slice(fixed.length)).toEqual([
      "Date entered Quoted", "Product line", "Time in Quoted", "Urgent?",
    ]);
  });

  it("are discovered as signals by the same rules a file's columns are", () => {
    const { headers, rows } = dealsToRows(deals);
    const { fields } = detectColumns(headers, rows);
    const { discovered } = discoverSignalColumns(headers, rows, fields, "b2c");
    expect(discovered.filter((d) => d.suggested).map((d) => d.column).sort()).toEqual(["Product line", "Urgent?"]);
  });

  it("carry the stage timing the early gate and the trust check read", () => {
    const { headers, rows } = dealsToRows(deals);
    const timing = detectStageTimingColumns(headers, rows);
    expect(timing).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "Quoted", kind: "entered" }),
      expect.objectContaining({ stage: "Quoted", kind: "duration", unit: "seconds" }),
    ]));
    expect(rows[0]["Date entered Quoted"]).toBe("2026-03-06");
    expect(rows[0]["Time in Quoted"]).toBe("7200");
  });

  it("do not appear at all when no deal carried them", () => {
    const { headers } = dealsToRows([deal(), deal()]);
    expect(headers).not.toContain("Product line");
    expect(headers.some((h) => h.startsWith("Date entered"))).toBe(false);
  });

  it("never overwrite a fixed column", () => {
    const { rows } = dealsToRows([deal({ industry: "Manufacturing", signals: { Industry: "Pets" } })]);
    expect(rows[0][HUBSPOT_HEADERS.industry]).toBe("Manufacturing");
  });
});
