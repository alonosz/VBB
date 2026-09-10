import { describe, expect, it } from "vitest";
import { parseEvents, signatureV3, verifyWebhook } from "./webhook";

const NOW = new Date("2026-09-10T15:00:00Z");
const URL_ = "https://valuebasedbidding.com/api/crm/hubspot/webhook";
const BODY = JSON.stringify([{ eventId: 1, portalId: 42, objectId: 7, subscriptionType: "contact.creation" }]);

describe("verifyWebhook", () => {
  it("accepts HubSpot's own signature over method, url, body and timestamp", () => {
    const timestamp = String(NOW.getTime() - 1000);
    const signature = signatureV3("secret", "POST", URL_, BODY, timestamp);
    expect(verifyWebhook({ secret: "secret", method: "POST", url: URL_, body: BODY, timestamp, signature, now: NOW }))
      .toEqual({ ok: true });
  });

  it("refuses a wrong secret, a changed body and a replay", () => {
    const timestamp = String(NOW.getTime() - 1000);
    const signature = signatureV3("secret", "POST", URL_, BODY, timestamp);
    expect(verifyWebhook({ secret: "other", method: "POST", url: URL_, body: BODY, timestamp, signature, now: NOW }))
      .toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebhook({ secret: "secret", method: "POST", url: URL_, body: BODY + " ", timestamp, signature, now: NOW }))
      .toEqual({ ok: false, reason: "mismatch" });
    const old = String(NOW.getTime() - 6 * 60_000);
    expect(verifyWebhook({
      secret: "secret", method: "POST", url: URL_, body: BODY, timestamp: old,
      signature: signatureV3("secret", "POST", URL_, BODY, old), now: NOW,
    })).toEqual({ ok: false, reason: "stale" });
    expect(verifyWebhook({ secret: "secret", method: "POST", url: URL_, body: BODY, timestamp: null, signature: null, now: NOW }))
      .toEqual({ ok: false, reason: "unsigned" });
  });
});

describe("parseEvents", () => {
  it("reads both of HubSpot's vocabularies and drops what cannot move a value", () => {
    const events = parseEvents([
      { eventId: 1, portalId: 42, objectId: 7, subscriptionType: "contact.creation", occurredAt: NOW.getTime() },
      { eventId: 2, portalId: 42, objectId: 9, subscriptionType: "deal.propertyChange", propertyName: "dealstage" },
      { eventId: 3, portalId: 42, objectId: 11, objectTypeId: "0-1", subscriptionType: "object.creation" },
      { eventId: 4, portalId: 42, objectId: 12, objectTypeId: "0-3", subscriptionType: "object.propertyChange", propertyName: "amount" },
      { eventId: 5, portalId: 42, objectId: 13, subscriptionType: "company.creation" },
      { eventId: 6, portalId: 42, objectId: 14, subscriptionType: "contact.deletion" },
      "junk",
    ]);

    expect(events.map((e) => [e.object, e.objectId, e.change, e.property])).toEqual([
      ["contact", "7", "created", null],
      ["deal", "9", "changed", "dealstage"],
      ["contact", "11", "created", null],
      ["deal", "12", "changed", "amount"],
    ]);
    expect(events[0].occurredAt).toEqual(NOW);
    expect(events[0].portalId).toBe("42");
  });

  it("is empty for anything that is not a list", () => {
    expect(parseEvents({})).toEqual([]);
    expect(parseEvents(null)).toEqual([]);
  });
});
