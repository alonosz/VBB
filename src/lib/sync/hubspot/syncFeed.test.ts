import { describe, expect, it } from "vitest";
import { syncAllFeeds, syncFeed } from "./syncFeed";
import { fakeSupabase } from "../fakeSupabase";
import { CrmConnectionStore } from "../connections";
import { generateKey, parseKey } from "../secrets";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { saveValueModel } from "@/lib/model/savedModel";
import { withOverrides } from "@/lib/analysis/valueModel";
import type { OAuthConfig } from "./oauth";

const KEY = parseKey(generateKey())!;
const NOW = new Date("2026-06-15T12:00:00Z");
const OAUTH: OAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://vbb-cyan.vercel.app/api/crm/hubspot/callback",
};

/** A portal holding two deals, one of which carries a click ID. */
function portal(over: { dealsStatus?: number; tokenStatus?: number } = {}) {
  const paths: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const target = String(url);
    const path = new URL(target).pathname;
    paths.push(path);

    if (path === "/oauth/v1/token") {
      if (over.tokenStatus && over.tokenStatus >= 400) {
        return new Response(JSON.stringify({ message: "no" }), { status: over.tokenStatus });
      }
      return new Response(
        JSON.stringify({ access_token: "renewed-access", refresh_token: "renewed-refresh", expires_in: 1800 })
      );
    }

    if (path.endsWith("/deals/search")) {
      if (over.dealsStatus && over.dealsStatus >= 400) {
        return new Response(JSON.stringify({}), { status: over.dealsStatus });
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "d1",
              properties: {
                createdate: "2026-06-12T09:00:00Z",
                dealstage: "stage-2",
                amount: "8200",
                hs_is_closed: "false",
              },
            },
          ],
        })
      );
    }

    if (path === "/crm/v4/associations/deals/contacts/batch/read") {
      return new Response(JSON.stringify({ results: [{ from: { id: "d1" }, to: [{ toObjectId: "c1" }] }] }));
    }
    if (path === "/crm/v4/associations/deals/companies/batch/read") {
      return new Response(JSON.stringify({ results: [{ from: { id: "d1" }, to: [{ toObjectId: "co1" }] }] }));
    }
    if (path === "/crm/v3/objects/contacts/batch/read") {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "c1",
              properties: {
                email: "dana.k@northridgefab.com",
                jobtitle: "Operations Manager",
                gclid: "Cj0KCQdanaexample1",
              },
            },
          ],
        })
      );
    }
    return new Response(
      JSON.stringify({
        results: [{ id: "co1", properties: { numberofemployees: "420", industry: "Manufacturing" } }],
      })
    );
  }) as unknown as typeof fetch;

  return { fetchImpl, paths };
}

async function scenario(opts: { expiresAt?: Date | null; withModel?: boolean } = {}) {
  const repo = new InMemoryFeedRepository(() => NOW);
  const { client, rows } = fakeSupabase();
  const connections = new CrmConnectionStore(client, KEY);

  const deals = generateDemoDeals();
  const fitted = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: NOW });
  const model = saveValueModel(withOverrides(fitted.valueModel, deals, {}), {
    deals, modelId: "model-1", gate: fitted.gate, now: NOW,
  });

  const feed = await repo.createFeed({
    tokenHash: "a".repeat(64), tokenPrefix: "vbb_live_8f2a",
    modelId: model.modelId, currencyCode: "USD", identifier: "clickId",
  });
  if (opts.withModel !== false) await repo.saveModel(feed.id, model);

  await connections.save({
    feedId: feed.id, provider: "hubspot",
    accessToken: "stored-access", refreshToken: "stored-refresh",
    expiresAt: opts.expiresAt === undefined ? new Date(NOW.getTime() + 3_600_000) : opts.expiresAt,
  });

  return { repo, connections, feed, model, rows };
}

describe("syncFeed", () => {
  it("pulls, prices and publishes without anyone watching", async () => {
    const { repo, connections, feed } = await scenario();
    const { fetchImpl } = portal();

    const outcome = await syncFeed({
      feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW,
    });

    expect(outcome.error).toBeNull();
    expect(outcome.report?.dealsPulled).toBe(1);
    expect(outcome.report?.rowsAdded).toBe(1);

    const [row] = await repo.rowsFor(feed.id);
    expect(row.clickId).toBe("Cj0KCQdanaexample1");
    expect(row.value).toBeGreaterThan(0);
    expect(row.kind).toBe("conversion");
    expect(row.currencyCode).toBe("USD");
  });

  it("records the run so a connection that stopped working is visible", async () => {
    const { repo, connections, feed, rows } = await scenario();
    await syncFeed({ feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW });
    expect(rows.get(feed.id)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 1 });
  });

  it("renews an expired token and stores the new one before pulling", async () => {
    const { repo, connections, feed, rows } = await scenario({
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    const { fetchImpl, paths } = portal();

    const outcome = await syncFeed({
      feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW,
    });

    expect(outcome.error).toBeNull();
    // Renewed first, so a later crash cannot strand a rotated refresh token.
    expect(paths[0]).toBe("/oauth/v1/token");
    expect(paths).toContain("/crm/v3/objects/deals/search");

    const stored = await connections.load(feed.id);
    expect(stored.connection?.accessToken).toBe("renewed-access");
    expect(stored.connection?.refreshToken).toBe("renewed-refresh");
    // And still never in the clear.
    expect(JSON.stringify(rows.get(feed.id))).not.toContain("renewed-access");
  });

  it("does not renew a token that is still good", async () => {
    const { repo, connections, feed } = await scenario();
    const { fetchImpl, paths } = portal();
    await syncFeed({ feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW });
    expect(paths).not.toContain("/oauth/v1/token");
  });

  it("says to reconnect when the renewal is refused, and publishes nothing", async () => {
    const { repo, connections, feed, rows } = await scenario({
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    const { fetchImpl } = portal({ tokenStatus: 400 });

    const outcome = await syncFeed({
      feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW,
    });

    expect(outcome.error).toMatch(/[Rr]econnect/);
    expect(await repo.rowsFor(feed.id)).toHaveLength(0);
    expect(rows.get(feed.id)).toMatchObject({ last_sync_status: "refused" });
  });

  it("treats an unreachable CRM as a night missed, not a failure to hide", async () => {
    const { repo, connections, feed, rows } = await scenario();
    const { fetchImpl } = portal({ dealsStatus: 500 });

    const waits: number[] = [];
    const outcome = await syncFeed({
      feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW,
      sleep: async (ms) => { waits.push(ms); },
    });

    // It retried before giving up — a nightly run is never urgent enough to
    // drop a day of leads on one bad response.
    expect(waits.length).toBeGreaterThan(0);
    expect(outcome.error).toMatch(/next run will pick these up/);
    expect(rows.get(feed.id)).toMatchObject({ last_sync_status: "failed" });
    expect(await repo.rowsFor(feed.id)).toHaveLength(0);
  });

  it("refuses a feed with no saved model rather than pricing at zero", async () => {
    const { repo, connections, feed } = await scenario({ withModel: false });
    const outcome = await syncFeed({
      feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW,
    });
    expect(outcome.error).toMatch(/no saved model/i);
    expect(await repo.rowsFor(feed.id)).toHaveLength(0);
  });

  it("refuses a revoked feed without touching the customer's CRM", async () => {
    const { repo, connections, feed } = await scenario();
    await repo.revokeFeed(feed.id);
    const { fetchImpl, paths } = portal();

    const outcome = await syncFeed({
      feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW,
    });

    expect(outcome.error).toMatch(/revoked/i);
    // runSync would refuse this too, but not before a pull. Reaching into
    // someone's HubSpot on behalf of a dead feed is not something to do and
    // then discard.
    expect(paths).toEqual([]);
  });

  it("is idempotent — a second run the same night sends nothing again", async () => {
    const { repo, connections, feed } = await scenario();
    const { fetchImpl } = portal();
    await syncFeed({ feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW });
    const second = await syncFeed({ feedId: feed.id, repo, connections, oauth: OAUTH, fetchImpl, now: NOW });
    expect(second.report?.rowsAdded).toBe(0);
    expect(await repo.rowsFor(feed.id)).toHaveLength(1);
  });
});

describe("syncAllFeeds", () => {
  it("one portal's failure does not cost every other advertiser their night", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { client } = fakeSupabase();
    const connections = new CrmConnectionStore(client, KEY);

    const deals = generateDemoDeals();
    const fitted = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: NOW });
    const model = saveValueModel(withOverrides(fitted.valueModel, deals, {}), {
      deals, modelId: "model-1", gate: fitted.gate, now: NOW,
    });

    const good = await repo.createFeed({
      tokenHash: "a".repeat(64), tokenPrefix: "vbb_live_aaaa",
      modelId: "model-1", currencyCode: "USD", identifier: "clickId",
    });
    const broken = await repo.createFeed({
      tokenHash: "b".repeat(64), tokenPrefix: "vbb_live_bbbb",
      modelId: "model-1", currencyCode: "USD", identifier: "clickId",
    });
    await repo.saveModel(good.id, model);
    // broken has a connection but no model, so it refuses.
    for (const id of [good.id, broken.id]) {
      await connections.save({
        feedId: id, provider: "hubspot", accessToken: "a", refreshToken: "r",
        expiresAt: new Date(NOW.getTime() + 3_600_000),
      });
    }

    const outcomes = await syncAllFeeds({
      repo, connections, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes.filter((o) => o.error)).toHaveLength(1);
    expect(await repo.rowsFor(good.id)).toHaveLength(1);
  });
});
