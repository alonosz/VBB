import { describe, expect, it } from "vitest";
import { handleWebhookEvents } from "./realtime";
import { fakeSupabase } from "../fakeSupabase";
import { CrmConnectionStore } from "../connections";
import { InMemorySyncRunStore } from "../runs";
import { generateKey, parseKey } from "../secrets";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { saveValueModel } from "@/lib/model/savedModel";
import { withOverrides } from "@/lib/analysis/valueModel";
import type { WebhookEvent } from "./webhook";

const KEY = parseKey(generateKey())!;
const NOW = new Date("2026-09-10T15:00:00Z");
const PORTAL = "424242";

/** A portal answering the reads a webhook makes for one new contact. */
function portal() {
  const paths: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : null;

    if (path === "/crm/v3/pipelines/deals") return new Response(JSON.stringify({ results: [] }));
    if (path.startsWith("/crm/v3/properties/")) return new Response(JSON.stringify({ results: [] }));
    if (path === "/crm/v3/objects/contacts/batch/read") {
      return new Response(JSON.stringify({
        results: body.inputs.map(({ id }: { id: string }) => ({
          id,
          properties: {
            // c-old arrived years ago; everyone else this afternoon.
            createdate: id === "c-old" ? "2022-03-01T09:00:00.000Z" : "2026-09-10T14:55:00.000Z",
            lifecyclestage: "lead",
            email: `lead${id}@northridgefab.com`,
            jobtitle: "Operations Manager",
            gclid: `Cj0KCQlive${id}example`,
            associatedcompanyid: "co1",
          },
        })),
      }));
    }
    if (path === "/crm/v4/associations/contacts/deals/batch/read") {
      // c1 and c2 share deal d1; nobody else has one.
      return new Response(JSON.stringify({
        results: body.inputs
          .filter(({ id }: { id: string }) => id === "c1" || id === "c2")
          .map(({ id }: { id: string }) => ({ from: { id }, to: [{ toObjectId: "d1" }] })),
      }));
    }
    if (path === "/crm/v4/associations/deals/contacts/batch/read") {
      const id = body.inputs[0].id;
      const to = id === "d-old" ? [{ toObjectId: "c-old" }] : [{ toObjectId: "c9" }];
      return new Response(JSON.stringify({ results: [{ from: { id }, to }] }));
    }
    if (path === "/crm/v3/objects/deals/batch/read") {
      return new Response(JSON.stringify({
        results: body.inputs.map(({ id }: { id: string }) => ({
          id,
          properties: { createdate: "2026-09-10T15:00:00.000Z", dealstage: "closedwon", amount: "5000", hs_is_closed: "true", hs_is_closed_won: "true" },
        })),
      }));
    }
    if (path === "/crm/v3/objects/companies/batch/read") {
      return new Response(JSON.stringify({
        results: [{ id: "co1", properties: { numberofemployees: "420", industry: "Manufacturing" } }],
      }));
    }
    return new Response(JSON.stringify({ results: [] }));
  }) as unknown as typeof fetch;
  return { fetchImpl, paths };
}

async function scenario(delivery: "url" | "api" = "url") {
  const repo = new InMemoryFeedRepository(() => NOW);
  const { client } = fakeSupabase();
  const connections = new CrmConnectionStore(client, KEY);
  const runs = new InMemorySyncRunStore();

  const deals = generateDemoDeals();
  const fitted = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: NOW });
  const model = saveValueModel(withOverrides(fitted.valueModel, deals, {}), {
    deals, modelId: "model-1", gate: fitted.gate, now: NOW,
  });
  const feed = await repo.createFeed({
    clientId: "ws-1", tokenHash: "e".repeat(64), tokenPrefix: "vbb_live_e",
    modelId: "model-1", currencyCode: "USD", identifier: "both", delivery,
  });
  await repo.saveModel(feed.id, model);

  await connections.save({
    workspaceId: "ws-1", provider: "hubspot", accessToken: "tok", refreshToken: null,
    expiresAt: null, externalAccountId: PORTAL,
  });
  return { repo, connections, runs, feed };
}

const created = (objectId: string): WebhookEvent => ({
  eventId: `e-${objectId}`, portalId: PORTAL, object: "contact", objectId, change: "created",
  property: null, occurredAt: NOW,
});

describe("handleWebhookEvents", () => {
  it("prices the named contact and publishes it, once", async () => {
    const { repo, connections, runs, feed } = await scenario();
    const { fetchImpl, paths } = portal();

    const first = await handleWebhookEvents({ events: [created("c1")], repo, connections, runs, fetchImpl, now: NOW });
    const again = await handleWebhookEvents({ events: [created("c1")], repo, connections, runs, fetchImpl, now: NOW });

    expect(first).toMatchObject({ portals: 1, workspaces: 1, leadsRead: 1, rowsAdded: 1, problems: [] });
    expect(again.rowsAdded).toBe(0);
    const rows = await repo.rowsFor(feed.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].clickId).toBe("Cj0KCQlivec1example");
    expect(rows[0].conversionTime.toISOString()).toBe("2026-09-10T14:55:00.000Z");
    expect(rows[0].value).toBeGreaterThan(0);
    // Never a search over the window: only the named record was read.
    expect(paths.some((p) => p.endsWith("/search"))).toBe(false);
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0].message).toMatch(/Live from HubSpot: 1 lead/);
  });

  it("follows a deal event back to its contact", async () => {
    const { repo, connections, feed } = await scenario();
    const event: WebhookEvent = {
      eventId: "e-d9", portalId: PORTAL, object: "deal", objectId: "d9", change: "changed",
      property: "dealstage", occurredAt: NOW,
    };
    const out = await handleWebhookEvents({ events: [event], repo, connections, fetchImpl: portal().fetchImpl, now: NOW });
    expect(out.rowsAdded).toBe(1);
    expect((await repo.rowsFor(feed.id))[0].clickId).toBe("Cj0KCQlivec9example");
  });

  it("stores the row and says why it could not be sent when Google is not connected", async () => {
    const { repo, connections, feed } = await scenario("api");
    const out = await handleWebhookEvents({ events: [created("c1")], repo, connections, fetchImpl: portal().fetchImpl, now: NOW });
    expect(out.rowsAdded).toBe(1);
    expect(out.sent).toBe(0);
    expect(out.problems[0]).toMatch(/Google Ads/);
    expect(await repo.pendingRows(feed.id)).toHaveLength(1);
  });

  it("counts a deal two named contacts share once, on the first, not twice on the last", async () => {
    const { repo, connections, feed } = await scenario();
    const out = await handleWebhookEvents({
      events: [created("c1"), created("c2")], repo, connections, fetchImpl: portal().fetchImpl, now: NOW,
    });
    expect(out.rowsAdded).toBe(2);
    const rows = await repo.rowsFor(feed.id);
    expect(rows.map((r) => r.clickId).sort()).toEqual(["Cj0KCQlivec1example", "Cj0KCQlivec2example"]);
    // Both priced, and neither at a doubled amount: two rows, two distinct leads.
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(2);
  });

  it("does not turn an old contact into a new conversion when its deal moves", async () => {
    const { repo, connections, feed } = await scenario();
    const event: WebhookEvent = {
      eventId: "e-d-old", portalId: PORTAL, object: "deal", objectId: "d-old", change: "changed",
      property: "dealstage", occurredAt: NOW,
    };
    const out = await handleWebhookEvents({ events: [event], repo, connections, fetchImpl: portal().fetchImpl, now: NOW });
    expect(out.rowsAdded).toBe(0);
    expect(out.leadsRead).toBe(0);
    expect(await repo.rowsFor(feed.id)).toEqual([]);
  });

  it("ignores a portal nobody connected", async () => {
    const { repo, connections } = await scenario();
    const out = await handleWebhookEvents({
      events: [{ ...created("c1"), portalId: "1" }], repo, connections, fetchImpl: portal().fetchImpl, now: NOW,
    });
    expect(out).toMatchObject({ portals: 1, workspaces: 0, rowsAdded: 0 });
    expect(out.problems[0]).toMatch(/not connected/);
  });
});
