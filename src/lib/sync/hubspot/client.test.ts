import { describe, expect, it } from "vitest";
import { HubSpotClient, HubSpotError, pullFromHubSpot } from "./client";

const NOW = new Date("2026-06-15T12:00:00Z");

interface Call { path: string; body: Record<string, unknown>; auth: string | null }

function stub(responses: (() => Response)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      path: new URL(String(url)).pathname,
      body: JSON.parse(String(init?.body ?? "{}")),
      auth: headers.get("authorization"),
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return next();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () => new Response(JSON.stringify(body), { status, headers });

function client(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return new HubSpotClient({
    accessToken: "crm-token-placeholder",
    fetchImpl,
    now: NOW,
    sleep: async () => {},
    ...over,
  });
}

const dealPage = (ids: string[], after?: string) => ({
  results: ids.map((id) => ({ id, properties: { createdate: "2026-06-01T00:00:00Z" } })),
  paging: after ? { next: { after } } : undefined,
});

describe("HubSpotClient", () => {
  it("asks only for deals inside the window, newest first", async () => {
    const { fetchImpl, calls } = stub([json(dealPage(["1", "2"]))]);
    await client(fetchImpl).listRecentDeals();

    expect(calls[0].path).toBe("/crm/v3/objects/deals/search");
    const filter = (calls[0].body.filterGroups as { filters: { propertyName: string; operator: string; value: string }[] }[])[0].filters[0];
    expect(filter).toMatchObject({ propertyName: "createdate", operator: "GTE" });
    // 30 days back from NOW, not the whole portal.
    expect(Number(filter.value)).toBe(NOW.getTime() - 30 * 86_400_000);
  });

  it("sends the token as a bearer header and never in the body", async () => {
    const { fetchImpl, calls } = stub([json(dealPage(["1"]))]);
    await client(fetchImpl).listRecentDeals();
    expect(calls[0].auth).toBe("Bearer crm-token-placeholder");
    expect(JSON.stringify(calls[0].body)).not.toContain("crm-token-placeholder");
  });

  it("follows pagination until HubSpot stops offering a cursor", async () => {
    const { fetchImpl, calls } = stub([
      json(dealPage(["1", "2"], "cursor-1")),
      json(dealPage(["3", "4"], "cursor-2")),
      json(dealPage(["5"])),
    ]);
    const deals = await client(fetchImpl).listRecentDeals();

    expect(deals.map((d) => d.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(calls).toHaveLength(3);
    expect(calls[1].body.after).toBe("cursor-1");
    expect(calls[2].body.after).toBe("cursor-2");
  });

  it("waits and retries a rate limit rather than dropping a day of leads", async () => {
    const sleeps: number[] = [];
    const { fetchImpl, calls } = stub([
      json({}, 429, { "retry-after": "3" }),
      json(dealPage(["1"])),
    ]);
    const deals = await client(fetchImpl, { sleep: async (ms: number) => { sleeps.push(ms); } })
      .listRecentDeals();

    expect(deals).toHaveLength(1);
    expect(calls).toHaveLength(2);
    // Honours the header rather than guessing.
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after repeated failures, saying nothing was published", async () => {
    const { fetchImpl } = stub([json({}, 500)]);
    await expect(client(fetchImpl).listRecentDeals()).rejects.toThrow(/Nothing was published/);
  });

  it("says to reconnect when the token is refused, and does not retry", async () => {
    const { fetchImpl, calls } = stub([json({}, 401)]);
    await expect(client(fetchImpl).listRecentDeals()).rejects.toThrow(/[Rr]econnect/);
    // Retrying a rejected credential just burns the portal's rate limit.
    expect(calls).toHaveLength(1);
  });

  it("batches associated records instead of one call per deal", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const { fetchImpl, calls } = stub([json({ results: [] })]);
    await client(fetchImpl).readBatch("contacts", ids, ["email"]);

    // 250 ids at 100 per batch, not 250 requests.
    expect(calls).toHaveLength(3);
    expect(calls[0].path).toBe("/crm/v3/objects/contacts/batch/read");
    expect((calls[0].body.inputs as unknown[]).length).toBe(100);
    expect((calls[2].body.inputs as unknown[]).length).toBe(50);
  });

  it("de-duplicates ids shared by several deals", async () => {
    const { fetchImpl, calls } = stub([json({ results: [] })]);
    await client(fetchImpl).readBatch("contacts", ["c1", "c1", "c2", "c1"], ["email"]);
    expect((calls[0].body.inputs as unknown[]).length).toBe(2);
  });
});

/** A portal that answers each endpoint the way HubSpot documents it. */
function portal(over: { deals?: unknown; contactLinks?: unknown; companyLinks?: unknown; contacts?: unknown; companies?: unknown } = {}) {
  const paths: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    const body =
      path.endsWith("/deals/search") ? over.deals ?? { results: [] }
      : path === "/crm/v4/associations/deals/contacts/batch/read" ? over.contactLinks ?? { results: [] }
      : path === "/crm/v4/associations/deals/companies/batch/read" ? over.companyLinks ?? { results: [] }
      : path === "/crm/v3/objects/contacts/batch/read" ? over.contacts ?? { results: [] }
      : over.companies ?? { results: [] };
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  return { fetchImpl, paths };
}

describe("pullFromHubSpot", () => {
  it("reads associations separately, because search does not return them", async () => {
    const { fetchImpl, paths } = portal({
      deals: { results: [{ id: "d1", properties: { createdate: "2026-06-01T00:00:00Z" } }] },
      contactLinks: { results: [{ from: { id: "d1" }, to: [{ toObjectId: "c1" }] }] },
      companyLinks: { results: [{ from: { id: "d1" }, to: [{ toObjectId: 55 }] }] },
      contacts: { results: [{ id: "c1", properties: { email: "a@b.com" } }] },
      companies: { results: [{ id: "55", properties: { industry: "Manufacturing" } }] },
    });

    const pull = await pullFromHubSpot(client(fetchImpl));

    expect(paths).toContain("/crm/v4/associations/deals/contacts/batch/read");
    expect(pull.contactsById.get("c1")?.properties.email).toBe("a@b.com");
    // Numeric ids come back as numbers on this endpoint and must still match.
    expect(pull.companiesById.get("55")?.properties.industry).toBe("Manufacturing");
    // And the links are attached to the deal, so the mapper can find them.
    expect(pull.deals[0].associations?.contacts?.results).toEqual([{ id: "c1" }]);
  });

  it("yields no associations rather than crashing on an unexpected shape", async () => {
    const { fetchImpl } = portal({
      deals: { results: [{ id: "d1", properties: {} }] },
      contactLinks: { results: [{ nothing: "recognisable" }] },
    });
    const pull = await pullFromHubSpot(client(fetchImpl));
    expect(pull.contactsById.size).toBe(0);
    expect(pull.deals).toHaveLength(1);
  });

  it("skips every follow-up call when the window held no deals", async () => {
    const { fetchImpl, paths } = portal({ deals: { results: [] } });
    const pull = await pullFromHubSpot(client(fetchImpl));
    expect(pull.deals).toHaveLength(0);
    expect(paths).toEqual(["/crm/v3/objects/deals/search"]);
  });

  it("does not batch-read records when nothing is associated", async () => {
    const { fetchImpl, paths } = portal({
      deals: { results: [{ id: "d1", properties: {} }] },
    });
    await pullFromHubSpot(client(fetchImpl));
    expect(paths).not.toContain("/crm/v3/objects/contacts/batch/read");
  });
});

describe("HubSpotError", () => {
  it("carries the status so a caller can tell a retry from a reconnect", () => {
    expect(new HubSpotError("x", 401).status).toBe(401);
  });
});
