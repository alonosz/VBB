import { describe, expect, it } from "vitest";
import {
  CONTACT_PROPERTIES,
  MAX_SIGNAL_PROPERTIES,
  currenciesInPull,
  googleClickIdProperties,
  hubspotToDeals,
  isLeadContact,
  leadOutcomeOf,
  outcomeOf,
  populationOf,
  signalPropertiesOf,
  signalsOf,
  stageDurationsOf,
  stageTimingOf,
  stageTimingProperties,
} from "./map";
import type { HubSpotObject, HubSpotPropertyDef, HubSpotPull } from "./types";

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
    // Not a fast pipeline - a backfill. Negative time is impossible rather
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

/**
 * Drawn from a real portal. The gclid sits on the contact under a property
 * labelled "Google Click ID", and the same portal carries Facebook and
 * LinkedIn click IDs beside it.
 *
 * Two ways to fail here, and the second is worse than the first. Missing the
 * Google property means no click IDs and a quiet fall back to email matching.
 * Picking up the Facebook one means sending an fbclid to Google Ads as though
 * it were a gclid - a value attached to nothing, reported as a success.
 */
describe("googleClickIdProperties", () => {
  const REAL_PORTAL = [
    { name: "email", label: "Email" },
    { name: "jobtitle", label: "Job Title" },
    { name: "google_click_id", label: "Google Click ID" },
    { name: "facebook_click_id", label: "Facebook Click ID" },
    { name: "linkedin_click_id", label: "LinkedIn Click ID" },
  ];

  it("finds the Google one", () => {
    expect(googleClickIdProperties(REAL_PORTAL)).toContain("google_click_id");
  });

  it("NEVER PICKS UP ANOTHER NETWORK'S CLICK ID", () => {
    const found = googleClickIdProperties(REAL_PORTAL);
    expect(found).not.toContain("facebook_click_id");
    expect(found).not.toContain("linkedin_click_id");
  });

  it("finds a property named nothing like the ones we guessed", () => {
    // The whole reason this exists: a portal is free to call it anything.
    expect(
      googleClickIdProperties([{ name: "p_47281__c", label: "Google Click ID" }])
    ).toEqual(["p_47281__c"]);
  });

  it("matches on the internal name when there is no label", () => {
    expect(googleClickIdProperties([{ name: "gclid" }])).toEqual(["gclid"]);
    expect(googleClickIdProperties([{ name: "gbraid" }])).toEqual(["gbraid"]);
    expect(googleClickIdProperties([{ name: "wbraid" }])).toEqual(["wbraid"]);
  });

  it("leaves unrelated properties alone", () => {
    expect(
      googleClickIdProperties([
        { name: "lifecyclestage", label: "Lifecycle Stage" },
        { name: "hs_object_id", label: "Record ID" },
        { name: "msclkid", label: "Microsoft Click ID" },
      ])
    ).toEqual([]);
  });

  it("puts a name we already knew before one we discovered", () => {
    // So a portal carrying both is read in the order the old code would have.
    expect(
      googleClickIdProperties([
        { name: "custom_google_click_id", label: "Google Click ID (legacy)" },
        { name: "gclid", label: "GCLID" },
      ])
    ).toEqual(["gclid", "custom_google_click_id"]);
  });

  it("reads the click ID off whatever property the portal actually uses", () => {
    const contact: HubSpotObject = {
      id: "c-1",
      properties: { email: "a@b.com", p_47281__c: "EAIaIQobChMIzfaU1aS0lQMV" },
    };
    const [mapped] = hubspotToDeals({
      deals: [deal({}, { contacts: { results: [{ id: "c-1" }] } })],
      contactsById: new Map([["c-1", contact]]),
      companiesById: new Map(),
      clickIdProperties: ["p_47281__c"],
    });
    expect(mapped.clickId).toBe("EAIaIQobChMIzfaU1aS0lQMV");
  });
});

/*
 * The portal's own dropdowns, read as signals. A consumer business on
 * HubSpot keeps what the lead asked for in properties it made itself, and
 * until these were pulled the connection priced every such lead the same.
 */
describe("signalPropertiesOf", () => {
  const def = (over: Partial<HubSpotPropertyDef>): HubSpotPropertyDef => ({
    name: "x", type: "enumeration", fieldType: "select", ...over,
  });

  it("takes the portal's own dropdowns, radios and checkboxes", () => {
    const out = signalPropertiesOf([
      def({ name: "product_line", label: "Product line", options: [{ value: "auto", label: "Auto" }] }),
      def({ name: "urgent", label: "Urgent?", type: "bool", fieldType: "booleancheckbox" }),
      def({ name: "coverage", label: "Coverage", fieldType: "radio" }),
    ], "deals");
    expect(out.map((s) => [s.header, s.kind])).toEqual([
      ["Coverage", "enumeration"],
      ["Product line", "enumeration"],
      ["Urgent?", "bool"],
    ]);
    expect(out[1].options).toEqual({ auto: "Auto" });
  });

  it("leaves free text, numbers, dates and multi-select alone", () => {
    const out = signalPropertiesOf([
      def({ name: "notes", label: "Notes", type: "string", fieldType: "textarea" }),
      def({ name: "budget", label: "Budget", type: "number", fieldType: "number" }),
      def({ name: "renewal", label: "Renewal", type: "date", fieldType: "date" }),
      def({ name: "interests", label: "Interests", fieldType: "checkbox" }),
    ], "deals");
    expect(out).toEqual([]);
  });

  it("leaves HubSpot's own properties alone, apart from the two that describe the lead", () => {
    const out = signalPropertiesOf([
      def({ name: "dealtype", label: "Deal Type", hubspotDefined: true }),
      def({ name: "hs_priority", label: "Priority", hubspotDefined: true }),
      def({ name: "hs_object_source", label: "Record source", hubspotDefined: true }),
      def({ name: "hs_all_owner_ids", label: "All owner ids", hubspotDefined: true }),
    ], "deals");
    expect(out.map((s) => s.name)).toEqual(["dealtype", "hs_priority"]);
  });

  /*
   * Lifecycle stage is "customer" exactly when the deal is won. It is the
   * outcome under another name, and HubSpot defines it, so it stays out
   * even though its shape is a perfect category.
   */
  it("never takes the outcome wearing another name", () => {
    const out = signalPropertiesOf([
      def({ name: "lifecyclestage", label: "Lifecycle Stage", hubspotDefined: true }),
      def({ name: "hs_lead_status", label: "Lead Status", hubspotDefined: true }),
      def({ name: "dealstage", label: "Deal Stage", hubspotDefined: true }),
    ], "contacts");
    expect(out).toEqual([]);
  });

  it("skips hidden and calculated properties", () => {
    const out = signalPropertiesOf([
      def({ name: "a", label: "A", hidden: true }),
      def({ name: "b", label: "B", calculated: true }),
    ], "deals");
    expect(out).toEqual([]);
  });

  it("never hands out a header already in use, and remembers the ones it gives", () => {
    const taken = new Set(["Industry"]);
    const deals = signalPropertiesOf([
      def({ name: "industry_c", label: "Industry" }),
      def({ name: "tier", label: "Tier" }),
    ], "deals", taken);
    expect(deals.map((s) => s.header)).toEqual(["Industry (deal)", "Tier"]);
    const contacts = signalPropertiesOf([def({ name: "tier_c", label: "Tier" })], "contacts", taken);
    expect(contacts.map((s) => s.header)).toEqual(["Tier (contact)"]);
  });

  it("caps the list, the portal's own properties first, in a stable order", () => {
    const many = Array.from({ length: MAX_SIGNAL_PROPERTIES + 5 }, (_, i) =>
      def({ name: `p${i}`, label: `Prop ${String(i).padStart(2, "0")}` })
    );
    const out = signalPropertiesOf([def({ name: "dealtype", label: "Deal Type", hubspotDefined: true }), ...many], "deals");
    expect(out).toHaveLength(MAX_SIGNAL_PROPERTIES);
    expect(out[0].header).toBe("Prop 00");
    expect(out.map((s) => s.name)).not.toContain("dealtype");
  });
});

describe("signalsOf", () => {
  const props = signalPropertiesOf([
    { name: "product_line", label: "Product line", type: "enumeration", fieldType: "select",
      options: [{ value: "auto", label: "Auto" }, { value: "home", label: "Home" }] },
    { name: "urgent", label: "Urgent?", type: "bool", fieldType: "booleancheckbox" },
  ], "deals");
  const contactProps = signalPropertiesOf([
    { name: "insured", label: "Currently insured", type: "enumeration", fieldType: "radio",
      options: [{ value: "yes", label: "Yes" }] },
  ], "contacts");

  it("writes the label a person sees, not the value the portal stores", () => {
    const deal: HubSpotObject = { id: "d1", properties: { product_line: "auto", urgent: "true" } };
    const contact: HubSpotObject = { id: "c1", properties: { insured: "yes" } };
    expect(signalsOf(deal, contact, [...props, ...contactProps])).toEqual({
      "Product line": "Auto",
      "Urgent?": "Yes",
      "Currently insured": "Yes",
    });
  });

  it("keeps a value the options list does not know, rather than dropping the row", () => {
    const deal: HubSpotObject = { id: "d1", properties: { product_line: "pet" } };
    expect(signalsOf(deal, undefined, props)).toEqual({ "Product line": "pet" });
  });

  it("is nothing when the deal carries none of them", () => {
    expect(signalsOf({ id: "d1", properties: { product_line: "" } }, undefined, props)).toBeUndefined();
  });
});

describe("what a pull carries through to the deal", () => {
  it("attaches the signals, the stage labels, the durations and the source", () => {
    const pull: HubSpotPull = {
      deals: [{
        id: "d1",
        properties: {
          createdate: CREATED, dealstage: "s1", product_line: "auto",
          hs_date_entered_s2: "2026-05-03T09:00:00Z", hs_time_in_s1: "172800000",
        },
        associations: { contacts: { results: [{ id: "c1" }] } },
      }],
      contactsById: new Map([["c1", { id: "c1", properties: { email: "a@b.com", hs_analytics_source: "PAID_SEARCH" } }]]),
      companiesById: new Map(),
      stageLabels: new Map([["s1", "New"], ["s2", "Quoted"]]),
      signalProperties: signalPropertiesOf([
        { name: "product_line", label: "Product line", type: "enumeration", fieldType: "select",
          options: [{ value: "auto", label: "Auto" }] },
      ], "deals"),
    };
    const [deal] = hubspotToDeals(pull);
    expect(deal.signals).toEqual({ "Product line": "Auto" });
    expect(deal.stage).toBe("New");
    expect(deal.source).toBe("PAID_SEARCH");
    expect(deal.stageReachedAfterDays).toEqual({ Quoted: 2 });
    expect(deal.stageDurations).toEqual({ New: 172800 });
  });

  it("asks for the source, which it used to read without requesting", () => {
    expect(CONTACT_PROPERTIES).toContain("hs_analytics_source");
  });

  it("names the timing properties by stage id, both kinds", () => {
    expect(stageTimingProperties(["s1"])).toEqual(["hs_date_entered_s1", "hs_time_in_s1"]);
  });

  it("reads durations in seconds from HubSpot's milliseconds", () => {
    expect(stageDurationsOf({ id: "d", properties: { hs_time_in_x: "9000" } })).toEqual({ x: 9 });
    expect(stageDurationsOf({ id: "d", properties: { hs_time_in_x: "-1" } })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Contacts as leads
// ---------------------------------------------------------------------------

/*
 * A consumer business opens a deal for a fraction of its leads. Reading
 * deals alone counted the close rate against the leads somebody had opened
 * a deal for, dated each one from the deal rather than from the click, and
 * never priced the rest at all.
 */
describe("the window's contacts as leads", () => {
  const ARRIVED = "2026-05-01T09:00:00.000Z";
  const contact = (id: string, props: Record<string, string | null> = {}): HubSpotObject => ({
    id,
    properties: { createdate: ARRIVED, email: `${id}@example.com`, ...props },
  });
  const withLeads = (leads: HubSpotObject[], deals: HubSpotObject[] = [], companies: HubSpotObject[] = []): HubSpotPull => ({
    deals,
    leads,
    contactsById: new Map(leads.map((c) => [c.id, c])),
    companiesById: new Map(companies.map((c) => [c.id, c])),
    stageLabels: new Map([["stage-2", "Qualified"], ["stage-9", "Closed Won"]]),
  });

  it("is one lead per contact, open until something says otherwise", () => {
    const [lead] = hubspotToDeals(withLeads([contact("c1")]));
    expect(lead).toMatchObject({ id: "contact-c1", outcome: "open", amount: null, email: "c1@example.com" });
    expect(lead.createdAt?.toISOString()).toBe(ARRIVED);
  });

  it("reads the contact's own fate when no deal was ever opened", () => {
    expect(leadOutcomeOf(contact("c", { lifecyclestage: "customer" }), [])).toBe("won");
    expect(leadOutcomeOf(contact("c", { hs_lead_status: "UNQUALIFIED" }), [])).toBe("lost");
    expect(leadOutcomeOf(contact("c", { hs_lead_status: "BAD_TIMING" }), [])).toBe("lost");
    expect(leadOutcomeOf(contact("c", { hs_lead_status: "IN_PROGRESS" }), [])).toBe("open");
  });

  it("lets the deal outrank the contact's flags", () => {
    const wonDeal = deal({ hs_is_closed_won: "true", hs_is_closed: "true" });
    expect(leadOutcomeOf(contact("c", { hs_lead_status: "UNQUALIFIED" }), [wonDeal])).toBe("won");
    const lostDeal = deal({ hs_is_closed: "true", hs_is_closed_won: "false" });
    expect(leadOutcomeOf(contact("c", { lifecyclestage: "customer" }), [lostDeal])).toBe("lost");
    expect(leadOutcomeOf(contact("c"), [lostDeal, deal({})])).toBe("open");
  });

  it("dates the lead from the click, not from the deal, and takes the deal's money", () => {
    const won = {
      ...deal({ amount: "1200", hs_is_closed_won: "true", hs_is_closed: "true", closedate: "2026-06-04T00:00:00Z",
        createdate: "2026-05-10T00:00:00Z", dealstage: "stage-9" }),
      associations: { contacts: { results: [{ id: "c1" }] } },
    };
    const leads = hubspotToDeals(withLeads([contact("c1")], [won]));
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ id: "contact-c1", outcome: "won", amount: 1200, stage: "Closed Won" });
    expect(leads[0].createdAt?.toISOString()).toBe(ARRIVED);
    expect(leads[0].closedAt?.toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });

  it("adds up several won deals and takes the stage off the newest", () => {
    const first = { ...deal({ amount: "100", hs_is_closed_won: "true", hs_is_closed: "true", createdate: "2026-05-02T00:00:00Z", dealstage: "stage-9" }),
      id: "d-a", associations: { contacts: { results: [{ id: "c1" }] } } };
    const second = { ...deal({ amount: "250", hs_is_closed_won: "true", hs_is_closed: "true", createdate: "2026-05-20T00:00:00Z", dealstage: "stage-2" }),
      id: "d-b", associations: { contacts: { results: [{ id: "c1" }] } } };
    const [lead] = hubspotToDeals(withLeads([contact("c1")], [first, second]));
    expect(lead.amount).toBe(350);
    expect(lead.stage).toBe("Qualified");
  });

  it("keeps a deal whose contact arrived before the window as a deal of its own", () => {
    const older = { ...deal({}), id: "d-old", associations: { contacts: { results: [{ id: "c-old" }] } } };
    const mapped = hubspotToDeals(withLeads([contact("c1")], [older]));
    expect(mapped.map((d) => d.id).sort()).toEqual(["contact-c1", "d-old"]);
  });

  it("counts a deal on one lead only", () => {
    const shared = { ...deal({ hs_is_closed_won: "true", hs_is_closed: "true", amount: "500" }),
      associations: { contacts: { results: [{ id: "c1" }, { id: "c2" }] } } };
    const mapped = hubspotToDeals(withLeads([contact("c1"), contact("c2")], [shared]));
    expect(mapped.filter((d) => d.outcome === "won")).toHaveLength(1);
  });

  it("leaves a newsletter subscriber out unless a deal says it was a lead", () => {
    expect(isLeadContact(contact("c", { lifecyclestage: "subscriber" }))).toBe(false);
    expect(isLeadContact(contact("c", { lifecyclestage: "lead" }))).toBe(true);
    const sub = contact("s1", { lifecyclestage: "subscriber" });
    expect(hubspotToDeals(withLeads([sub]))).toHaveLength(0);
    const dealt = { ...deal({}), associations: { contacts: { results: [{ id: "s1" }] } } };
    expect(hubspotToDeals(withLeads([sub], [dealt]))).toHaveLength(1);
  });

  it("finds the company through the contact when no deal names one", () => {
    const co: HubSpotObject = { id: "77", properties: { industry: "Insurance", numberofemployees: "12" } };
    const [lead] = hubspotToDeals(withLeads([contact("c1", { associatedcompanyid: "77" })], [], [co]));
    expect(lead.industry).toBe("Insurance");
    expect(lead.employeeCount).toBe(12);
  });

  it("carries the contact's own dropdowns as signals with no deal at all", () => {
    const pullWith = withLeads([contact("c1", { insured: "yes" })]);
    pullWith.signalProperties = signalPropertiesOf([
      { name: "insured", label: "Currently insured", type: "enumeration", fieldType: "radio",
        options: [{ value: "yes", label: "Yes" }] },
    ], "contacts");
    const [lead] = hubspotToDeals(pullWith);
    expect(lead.signals).toEqual({ "Currently insured": "Yes" });
  });

  it("is the deals alone when the pull could not read contacts", () => {
    const p = pull(deal({}));
    expect(p.leads).toBeUndefined();
    expect(hubspotToDeals(p).map((d) => d.id)).toEqual(["deal-1"]);
  });

  it("says what the window held", () => {
    const older = { ...deal({}), id: "d-old", associations: { contacts: { results: [{ id: "c-old" }] } } };
    const sub = contact("s1", { lifecyclestage: "subscriber" });
    expect(populationOf(withLeads([contact("c1"), sub], [older]))).toEqual({
      leads: 1,
      dealsWithoutLead: 1,
      subscribersSkipped: 1,
    });
  });
});
