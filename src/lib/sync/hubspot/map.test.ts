import { describe, expect, it } from "vitest";
import { hubspotToDeals, outcomeOf, stageTimingOf } from "./map";
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
