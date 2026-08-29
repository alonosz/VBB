import { describe, expect, it } from "vitest";
import { currenciesInPull, hubspotToDeals, outcomeOf, stageTimingOf } from "./map";
import type { HubSpotObject, HubSpotPull } from "./types";

const CREATED = "2026-05-01T09:00:00Z";

function deal(props: Record<string, string | null>, assoc?: HubSpotObject["associations"]): HubSpotObject {
  return {
    id: "deal-1",
    properties: { createdate: CREATED, dealstage: "stage-2", ...props },
    associations: assoc,
  };
}

function pull(d: HubSpotObject, contacts: HubSpotObject[] = [], companies: HubSpotObject[] = []): HubSpotPull {
  return {
    deals: [d],
    contactsById: new Map(contacts.map((c) => [c.id, c])),
    companiesById: new Map(companies.map((c) => [c.id, c])),
    stageLabels: new Map([["stage-2", "Qualified"], ["stage-9", "Closed Won"]]),
  };
}

describe("outcomeOf", () => {
  it("reads HubSpot's own flags, not the stage name", () => {
    expect(outcomeOf(deal({ hs_is_closed_won: "true", hs_is_closed: "true" }))).toBe("won");
    expect(outcomeOf(deal({ hs_is_closed: "true", hs_is_closed_won: "false" }))).toBe("lost");
    expect(outcomeOf(deal({}))).toBe("open");
  });

  it("does not mistake a stage called \"Won back\" for a win", () => {
    // The reason we read flags: matching the word would get this wrong.
    expect(outcomeOf(deal({ dealstage: "Won back", hs_is_closed: "true", hs_is_closed_won: "false" })))
      .toBe("lost");
  });
});

describe("hubspotToDeals", () => {
  it("pulls the lead's attributes off the associated contact and company", () => {
    const contact: HubSpotObject = {
      id: "c1",
      properties: { email: "dana.k@northridgefab.com", jobtitle: "Operations Manager", gclid: "Cj0KCQ_dana_example" },
    };
    const company: HubSpotObject = {
      id: "co1",
      properties: { numberofemployees: "420", industry: "Manufacturing" },
    };
    const d = deal({ amount: "18400", hs_is_closed_won: "true", hs_is_closed: "true", closedate: "2026-06-04T00:00:00Z" }, {
      contacts: { results: [{ id: "c1" }] },
      companies: { results: [{ id: "co1" }] },
    });

    const [mapped] = hubspotToDeals(pull(d, [contact], [company]));
    expect(mapped).toMatchObject({
      id: "deal-1",
      outcome: "won",
      amount: 18400,
      email: "dana.k@northridgefab.com",
      contactTitle: "Operations Manager",
      clickId: "Cj0KCQ_dana_example",
      employeeCount: 420,
      industry: "Manufacturing",
      stage: "Qualified",
    });
    expect(mapped.createdAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  it("leaves everything null when a deal has no associations", () => {
    const [mapped] = hubspotToDeals(pull(deal({})));
    // Missing is missing. The engine excludes it and says so; a default here
    // would become a priced lead built on nothing.
    expect(mapped.email).toBeNull();
    expect(mapped.clickId).toBeNull();
    expect(mapped.employeeCount).toBeNull();
    expect(mapped.industry).toBeNull();
    expect(mapped.contactTitle).toBeNull();
  });

  it("reads a click ID from whichever property the form used", () => {
    for (const key of ["gclid", "hs_google_click_id", "gclid__c", "wbraid"]) {
      const contact: HubSpotObject = { id: "c1", properties: { [key]: "Cj0KCQabcdefgh" } };
      const [mapped] = hubspotToDeals(
        pull(deal({}, { contacts: { results: [{ id: "c1" }] } }), [contact])
      );
      expect(mapped.clickId, key).toBe("Cj0KCQabcdefgh");
    }
  });

  it("refuses something in the click-ID field that is not a click ID", () => {
    for (const junk of ["dana@example.com", "n/a", "", "  "]) {
      const contact: HubSpotObject = { id: "c1", properties: { gclid: junk } };
      const [mapped] = hubspotToDeals(
        pull(deal({}, { contacts: { results: [{ id: "c1" }] } }), [contact])
      );
      expect(mapped.clickId, junk).toBeNull();
    }
  });

  it("handles the string shapes HubSpot actually returns for numbers", () => {
    const company: HubSpotObject = { id: "co1", properties: { numberofemployees: "1,200" } };
    const [mapped] = hubspotToDeals(
      pull(deal({ amount: "" }, { companies: { results: [{ id: "co1" }] } }), [], [company])
    );
    expect(mapped.employeeCount).toBe(1200);
    expect(mapped.amount).toBeNull();
  });

  it("parses epoch-millisecond dates as well as ISO ones", () => {
    const epoch = String(Date.UTC(2026, 4, 1, 9, 0, 0));
    const [mapped] = hubspotToDeals(pull(deal({ createdate: epoch })));
    expect(mapped.createdAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });
});

describe("stageTimingOf", () => {
  const created = new Date(CREATED);

  it("turns hs_date_entered_* into days from creation, with readable labels", () => {
    const d = deal({
      hs_date_entered_stage_2: "2026-05-04T09:00:00Z",
      hs_date_entered_stage_9: "2026-06-04T09:00:00Z",
    });
    const timing = stageTimingOf(d, created, new Map([["stage_2", "Qualified"], ["stage_9", "Closed Won"]]));
    expect(timing).toEqual({ Qualified: 3, "Closed Won": 34 });
  });

  it("keeps the opaque id rather than inventing a name for it", () => {
    const d = deal({ hs_date_entered_1049283: "2026-05-04T09:00:00Z" });
    expect(stageTimingOf(d, created)).toEqual({ "1049283": 3 });
  });

  it("drops a stage entered before the deal existed", () => {
    // Not a fast pipeline — a backfill. Negative time is impossible rather
    // than merely suspicious, so it goes here rather than to stageTrustCheck.
    const d = deal({ hs_date_entered_stage_2: "2026-04-01T09:00:00Z" });
    expect(stageTimingOf(d, created)).toBeUndefined();
  });

  it("returns nothing when there is no create date to measure from", () => {
    const d = deal({ hs_date_entered_stage_2: "2026-05-04T09:00:00Z" });
    expect(stageTimingOf(d, null)).toBeUndefined();
  });
});

/**
 * The bug these exist for: MappedDeal.amount is a reporting-currency figure by
 * contract, and this mapper used to take HubSpot's `amount` raw. A portal
 * selling in two currencies produced amounts that looked comparable and were
 * not, which is the failure the CSV path has guarded against since it shipped.
 */
describe("currency", () => {
  const usd = { reportingCurrency: "USD", rates: {}, excludeUnconvertible: true };

  function priced(amount: string, code?: string): HubSpotObject {
    return deal(code ? { amount, deal_currency_code: code } : { amount });
  }

  it("takes an amount already in the reporting currency at face value", () => {
    const [mapped] = hubspotToDeals(pull(priced("1000", "USD")), usd);
    expect(mapped.amount).toBe(1000);
  });

  it("converts with a rate that was set", () => {
    const [mapped] = hubspotToDeals(pull(priced("1000", "GBP")), {
      ...usd,
      rates: { GBP: 1.27 },
    });
    expect(mapped.amount).toBe(1270);
  });

  it("leaves a foreign amount unpriced rather than counting it as the reporting currency", () => {
    const [mapped] = hubspotToDeals(pull(priced("1000", "GBP")), usd);
    expect(mapped.amount).toBeNull();
  });

  it("takes an amount at face value when HubSpot returns no currency code", () => {
    // Single-currency portals do not always send the property. Nulling every
    // amount over a missing field would break the common case.
    const [mapped] = hubspotToDeals(pull(priced("1000")), usd);
    expect(mapped.amount).toBe(1000);
  });

  it("leaves amounts alone when no policy is supplied", () => {
    const [mapped] = hubspotToDeals(pull(priced("1000", "GBP")));
    expect(mapped.amount).toBe(1000);
  });

  it("reports the currencies a portal actually deals in, commonest first", () => {
    const p: HubSpotPull = {
      deals: [
        { id: "a", properties: { amount: "10", deal_currency_code: "GBP" } },
        { id: "b", properties: { amount: "10", deal_currency_code: "USD" } },
        { id: "c", properties: { amount: "10", deal_currency_code: "USD" } },
        // No amount, so nothing to convert and nothing to ask a rate for.
        { id: "d", properties: { deal_currency_code: "EUR" } },
      ],
      contactsById: new Map(),
      companiesById: new Map(),
    };
    expect(currenciesInPull(p)).toEqual([
      { code: "USD", count: 2 },
      { code: "GBP", count: 1 },
    ]);
  });
});
