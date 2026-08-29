import { describe, expect, it } from "vitest";
import { syncAllFeeds, syncFeed } from "./syncFeed";
import { fakeSupabase } from "../fakeSupabase";
import { CrmConnectionStore } from "../connections";
import { InMemorySyncRunStore } from "../runs";
import { generateKey, parseKey } from "../secrets";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { saveValueModel } from "@/lib/model/savedModel";
import { withOverrides } from "@/lib/analysis/valueModel";
import type { OAuthConfig } from "./oauth";

const KEY = parseKey(generateKey())!;
const WORKSPACE = "ws-1";
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
    clientId: WORKSPACE,
    tokenHash: "a".repeat(64), tokenPrefix: "vbb_live_8f2a",
    modelId: model.modelId, currencyCode: "USD", identifier: "clickId",
  });
  if (opts.withModel !== false) await repo.saveModel(feed.id, model);

  await connections.save({
    workspaceId: WORKSPACE, provider: "hubspot",
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
    expect(rows.get(WORKSPACE)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 1 });
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

    const stored = await connections.load(WORKSPACE);
    expect(stored.connection?.accessToken).toBe("renewed-access");
    expect(stored.connection?.refreshToken).toBe("renewed-refresh");
    // And still never in the clear.
    expect(JSON.stringify(rows.get(WORKSPACE))).not.toContain("renewed-access");
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
    expect(rows.get(WORKSPACE)).toMatchObject({ last_sync_status: "refused" });
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
    expect(rows.get(WORKSPACE)).toMatchObject({ last_sync_status: "failed" });
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
      clientId: WORKSPACE,
      tokenHash: "a".repeat(64), tokenPrefix: "vbb_live_aaaa",
      modelId: "model-1", currencyCode: "USD", identifier: "clickId",
    });
    // Same customer, no saved model — it must refuse while the other runs.
    await repo.createFeed({
      clientId: WORKSPACE,
      tokenHash: "b".repeat(64), tokenPrefix: "vbb_live_bbbb",
      modelId: "model-1", currencyCode: "USD", identifier: "clickId",
    });
    await repo.saveModel(good.id, model);
    // Both feeds belong to one customer, so one connection covers both. broken
    // has no model, so it refuses while good still runs.
    await connections.save({
      workspaceId: WORKSPACE, provider: "hubspot", accessToken: "a", refreshToken: "r",
      expiresAt: new Date(NOW.getTime() + 3_600_000),
    });

    const outcomes = await syncAllFeeds({
      repo, connections, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes.filter((o) => o.error)).toHaveLength(1);
    expect(await repo.rowsFor(good.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Every run leaves a trace
// ---------------------------------------------------------------------------

describe("recording the run", () => {
  it("records a success with the counts an operator is asked about", async () => {
    const { repo, connections, feed } = await scenario();
    const runs = new InMemorySyncRunStore();
    await syncFeed({
      feedId: feed.id, repo, connections, runs, oauth: OAUTH,
      fetchImpl: portal().fetchImpl, now: NOW,
    });

    const [recorded] = runs.runs;
    expect(recorded).toMatchObject({
      status: "ok", clientId: feed.clientId, feedId: feed.id,
      dealsPulled: 1, rowsPublished: 1, newConversions: 1,
    });
    expect(recorded.modelId).toBe("model-1");
  });

  it("records a refusal WITH ITS REASON, never a silent one", async () => {
    const { repo, connections, feed } = await scenario({ withModel: false });
    const runs = new InMemorySyncRunStore();
    await syncFeed({
      feedId: feed.id, repo, connections, runs, oauth: OAUTH,
      fetchImpl: portal().fetchImpl, now: NOW,
    });

    expect(runs.runs[0].status).toBe("refused");
    expect(runs.runs[0].message).toMatch(/no saved model/i);
  });

  it("records a failure when the CRM is unreachable", async () => {
    const { repo, connections, feed } = await scenario();
    const runs = new InMemorySyncRunStore();
    await syncFeed({
      feedId: feed.id, repo, connections, runs, oauth: OAUTH,
      fetchImpl: portal({ dealsStatus: 500 }).fetchImpl, now: NOW,
      sleep: async () => {},
    });

    expect(runs.runs[0].status).toBe("failed");
    expect(runs.runs[0].message).toMatch(/next run will pick these up/);
  });

  it("records a revoked feed rather than exiting quietly", async () => {
    const { repo, connections, feed } = await scenario();
    await repo.revokeFeed(feed.id);
    const runs = new InMemorySyncRunStore();
    await syncFeed({
      feedId: feed.id, repo, connections, runs, oauth: OAUTH,
      fetchImpl: portal().fetchImpl, now: NOW,
    });

    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0].status).toBe("refused");
  });

  it("EVERY exit path leaves exactly one record", async () => {
    // The guarantee the table rests on. A path that returns without recording
    // is indistinguishable from a night the job never ran.
    const cases: { name: string; run: () => Promise<InMemorySyncRunStore> }[] = [
      {
        name: "success",
        run: async () => {
          const { repo, connections, feed } = await scenario();
          const runs = new InMemorySyncRunStore();
          await syncFeed({ feedId: feed.id, repo, connections, runs, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW });
          return runs;
        },
      },
      {
        name: "no model",
        run: async () => {
          const { repo, connections, feed } = await scenario({ withModel: false });
          const runs = new InMemorySyncRunStore();
          await syncFeed({ feedId: feed.id, repo, connections, runs, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW });
          return runs;
        },
      },
      {
        name: "renewal refused",
        run: async () => {
          const { repo, connections, feed } = await scenario({ expiresAt: new Date(NOW.getTime() - 1000) });
          const runs = new InMemorySyncRunStore();
          await syncFeed({ feedId: feed.id, repo, connections, runs, oauth: OAUTH, fetchImpl: portal({ tokenStatus: 400 }).fetchImpl, now: NOW });
          return runs;
        },
      },
      {
        name: "CRM unreachable",
        run: async () => {
          const { repo, connections, feed } = await scenario();
          const runs = new InMemorySyncRunStore();
          await syncFeed({ feedId: feed.id, repo, connections, runs, oauth: OAUTH, fetchImpl: portal({ dealsStatus: 500 }).fetchImpl, now: NOW, sleep: async () => {} });
          return runs;
        },
      },
      {
        name: "feed missing",
        run: async () => {
          const { repo, connections } = await scenario();
          const runs = new InMemorySyncRunStore();
          await syncFeed({ feedId: "no-such-feed", repo, connections, runs, oauth: OAUTH, fetchImpl: portal().fetchImpl, now: NOW });
          return runs;
        },
      },
    ];

    for (const { name, run } of cases) {
      const runs = await run();
      expect(runs.runs, `${name} left no record`).toHaveLength(1);
      expect(runs.runs[0].status, name).toMatch(/^(ok|refused|failed)$/);
      // A refusal without a reason is the exact silent failure to avoid.
      if (runs.runs[0].status === "refused") {
        expect(runs.runs[0].message, `${name} refused without saying why`).toBeTruthy();
      }
    }
  });
});
