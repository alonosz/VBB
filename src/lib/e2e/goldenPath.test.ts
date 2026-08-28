import { describe, expect, it } from "vitest";

import { InMemoryWorkspaceRepository } from "@/lib/workspace/repository";
import { generateWorkspaceKey } from "@/lib/workspace/key";
import { authorizeWorkspace, feedInWorkspace } from "@/lib/workspace/authorize";
import { buildOverview } from "@/lib/workspace/overview";

import { InMemoryFeedRepository } from "@/lib/feed/repository";
import { publishFeed, serveFeed, feedStatus, CONVERSION_NAME } from "@/lib/feed/handlers";
import { buildFeedRows, bestIdentifier } from "@/lib/feed/publish";
import { generateFeedToken } from "@/lib/feed/token";
import { normalizeEmail, sha256Hex } from "@/lib/export/googleAds";

import { CrmConnectionStore } from "@/lib/sync/connections";
import { InMemorySyncRunStore } from "@/lib/sync/runs";
import { fakeSupabase } from "@/lib/sync/fakeSupabase";
import { generateKey, parseKey } from "@/lib/sync/secrets";
import { syncFeed } from "@/lib/sync/hubspot/syncFeed";

import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { valueAllLeads, withOverrides } from "@/lib/analysis/valueModel";
import { saveValueModel, savedModelToValueModel } from "@/lib/model/savedModel";
import { hubspotToDeals } from "@/lib/sync/hubspot/map";

/**
 * The whole customer journey, in one test.
 *
 * Every part of this has its own unit tests. This exists for the seam between
 * them: an operator creates a workspace, a customer maps their export and
 * approves a model, publishes a feed, connects HubSpot, the nightly job runs
 * unattended, Google collects the file, and the workspace page reports that it
 * all worked.
 *
 * Anything that breaks the handover from one step to the next shows up here
 * and nowhere else.
 */

const NOW = new Date("2026-06-15T12:00:00Z");
const ORIGIN = "https://vbb.example";
const ENCRYPTION_KEY = parseKey(generateKey())!;

/** A HubSpot portal with one recent deal carrying a click ID. */
function hubspot() {
  return (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;

    if (path.endsWith("/deals/search")) {
      return new Response(JSON.stringify({
        results: [{
          id: "d-new",
          properties: {
            createdate: "2026-06-13T09:00:00Z",
            dealstage: "stage-2",
            amount: "8200",
            hs_is_closed: "false",
          },
        }],
      }));
    }
    if (path === "/crm/v4/associations/deals/contacts/batch/read") {
      return new Response(JSON.stringify({ results: [{ from: { id: "d-new" }, to: [{ toObjectId: "c1" }] }] }));
    }
    if (path === "/crm/v4/associations/deals/companies/batch/read") {
      return new Response(JSON.stringify({ results: [{ from: { id: "d-new" }, to: [{ toObjectId: "co1" }] }] }));
    }
    if (path === "/crm/v3/objects/contacts/batch/read") {
      return new Response(JSON.stringify({ results: [{ id: "c1", properties: {
        email: "dana.k@northridgefab.com", jobtitle: "Operations Manager", gclid: "Cj0KCQgoldenpath1",
      } }] }));
    }
    return new Response(JSON.stringify({ results: [{ id: "co1", properties: {
      numberofemployees: "420", industry: "Manufacturing",
    } }] }));
  }) as unknown as typeof fetch;
}

describe("the golden path", () => {
  it("carries a customer from onboarding to Google collecting real values", async () => {
    // --- 1. The operator creates a workspace -------------------------------
    const workspaces = new InMemoryWorkspaceRepository(() => NOW);
    const generated = await generateWorkspaceKey();
    await workspaces.create({
      name: "Northridge Fabrication",
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
    });

    const auth = await authorizeWorkspace(workspaces, generated.key);
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;

    // --- 2. The customer's export is analysed and a model approved ---------
    const deals = generateDemoDeals();
    const diagnostic = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: NOW });
    const applied = withOverrides(diagnostic.valueModel, deals, {});
    const artifact = saveValueModel(applied, {
      deals, modelId: "model-golden", gate: diagnostic.gate, now: NOW,
    });

    expect(artifact.factors.length).toBeGreaterThan(0);
    expect(artifact.gate).toBeTruthy();

    // --- 3. They publish a feed -------------------------------------------
    const feeds = new InMemoryFeedRepository(() => NOW);
    const valued = valueAllLeads(deals, applied);
    const identifier = bestIdentifier(valued);
    const { rows } = await buildFeedRows({
      leads: valued, modelId: artifact.modelId, currencyCode: "USD", identifier,
      gate: diagnostic.gate, now: NOW,
    });

    const published = await publishFeed(
      feeds,
      {
        modelId: artifact.modelId,
        currencyCode: "USD",
        identifier,
        rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
        model: artifact,
      },
      ORIGIN,
      auth.workspace.id
    );

    const publishBody = JSON.parse(published.body) as Record<string, unknown>;
    expect(published.status).toBe(200);
    expect(publishBody.modelStored).toBe(true);
    const feedUrl = publishBody.feedUrl as string;
    const feedId = publishBody.feedId as string;

    // Google validates the extension off the end of the URL.
    expect(feedUrl).toMatch(/\.csv$/);

    // The feed belongs to this workspace and no other.
    expect((await feedInWorkspace(feeds, feedId, auth.workspace)).ok).toBe(true);

    // --- 4. They connect HubSpot ------------------------------------------
    const { client } = fakeSupabase();
    const connections = new CrmConnectionStore(client, ENCRYPTION_KEY);
    await connections.save({
      feedId, provider: "hubspot", accessToken: "portal-token-placeholder",
      refreshToken: null, expiresAt: null, scopes: "private-app",
    });

    // --- 5. The nightly job runs with nobody watching ----------------------
    const runs = new InMemorySyncRunStore();
    const rowsBefore = (await feeds.rowsFor(feedId)).length;

    const outcome = await syncFeed({
      feedId, repo: feeds, connections, runs,
      fetchImpl: hubspot(), now: NOW,
    });

    expect(outcome.error).toBeNull();
    expect(outcome.report?.dealsPulled).toBe(1);
    expect(runs.runs[0].status).toBe("ok");

    const rowsAfter = await feeds.rowsFor(feedId);
    expect(rowsAfter.length).toBe(rowsBefore + 1);

    // The new lead is priced by the frozen model, not a refit — and it is
    // stored under whichever identifier the feed was published with. This
    // demo file has 464 emails to 85 click IDs, so it matches on hashed
    // email; the row must follow the feed rather than the lead.
    const expectedId = identifier === "clickId"
      ? "Cj0KCQgoldenpath1"
      : await sha256Hex(normalizeEmail("dana.k@northridgefab.com"));
    const fromHubSpot = rowsAfter.find(
      (r) => (identifier === "clickId" ? r.clickId : r.hashedEmail) === expectedId
    );
    expect(fromHubSpot, `no row for the HubSpot lead under ${identifier}`).toBeDefined();
    expect(fromHubSpot!.modelId).toBe("model-golden");

    // The exact figure the frozen model predicts, recomputed here rather than
    // read back. "Greater than zero" would pass while the nightly job quietly
    // repriced everyone — which is the failure the frozen-model rule exists to
    // prevent, so it is the one this has to catch.
    const asHubSpotSentIt = hubspotToDeals({
      deals: [{
        id: "d-new",
        properties: { createdate: "2026-06-13T09:00:00Z", dealstage: "stage-2", amount: "8200", hs_is_closed: "false" },
        associations: { contacts: { results: [{ id: "c1" }] }, companies: { results: [{ id: "co1" }] } },
      }],
      contactsById: new Map([["c1", { id: "c1", properties: {
        email: "dana.k@northridgefab.com", jobtitle: "Operations Manager", gclid: "Cj0KCQgoldenpath1",
      } }]]),
      companiesById: new Map([["co1", { id: "co1", properties: {
        numberofemployees: "420", industry: "Manufacturing",
      } }]]),
    });
    const [predicted] = valueAllLeads(asHubSpotSentIt, savedModelToValueModel(artifact));
    expect(fromHubSpot!.value).toBe(predicted.value);

    // Google's import carries one identifier type per file, so every row has
    // to agree with the feed — a mixed file is rejected outright.
    for (const row of rowsAfter) {
      if (identifier === "clickId") {
        expect(row.clickId).not.toBeNull();
        expect(row.hashedEmail).toBeNull();
      } else {
        expect(row.hashedEmail).toMatch(/^[0-9a-f]{64}$/);
        expect(row.clickId).toBeNull();
      }
    }

    // --- 6. Google collects the file --------------------------------------
    const token = new URL(feedUrl).pathname.split("/").pop()!.replace(/\.csv$/, "");
    const served = await serveFeed(feeds, {
      token, ip: "66.249.66.1", userAgent: "Google-Ads-Offline-Conversions", now: NOW,
    });

    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toMatch(/text\/csv/);

    const csv = served.body;
    const [header, ...body] = csv.trim().split("\n");
    // Google matches rows to a conversion action by name.
    expect(csv).toContain(CONVERSION_NAME);
    expect(header).toMatch(/Google Click ID|Email/);
    expect(body.length).toBeGreaterThan(rowsBefore);
    // Nothing identifying a person reaches the file beyond what Google's
    // template requires.
    expect(csv).not.toContain("dana.k@northridgefab.com");
    expect(csv).not.toContain("Operations Manager");

    // --- 7. The workspace page says it is all working ----------------------
    const overview = await buildOverview(auth.workspace, {
      feeds, connections, runs, now: NOW,
    });

    expect(overview.workspace.name).toBe("Northridge Fabrication");
    expect(overview.feed?.rowsPublished).toBe(rowsAfter.length);
    expect(overview.feed?.lastFetchedAt).not.toBeNull();
    expect(overview.model?.modelId).toBe("model-golden");
    expect(overview.connection.connected).toBe(true);
    expect(overview.runs).toHaveLength(1);
    expect(overview.health.state).toBe("healthy");

    // The end state the whole product exists to reach.
    expect(overview.working).toBe(true);
    expect(overview.actions[0].severity).toBe("info");
    expect(overview.actions[0].action).toMatch(/Maximize conversion value/);

    // And the status endpoint agrees, without counting as a fetch.
    const status = await feedStatus(feeds, token, NOW);
    const statusBody = JSON.parse(status.body) as { status: { verdict: string } };
    expect(statusBody.status.verdict).toBe("collecting");
  });

  it("keeps a second customer entirely separate", async () => {
    const workspaces = new InMemoryWorkspaceRepository(() => NOW);
    const feeds = new InMemoryFeedRepository(() => NOW);

    const a = await generateWorkspaceKey();
    const b = await generateWorkspaceKey();
    const northridge = await workspaces.create({ name: "Northridge", keyHash: a.keyHash, keyPrefix: a.keyPrefix });
    const acme = await workspaces.create({ name: "Acme", keyHash: b.keyHash, keyPrefix: b.keyPrefix });

    const theirs = await feeds.createFeed({
      clientId: northridge.id, tokenHash: (await generateFeedToken()).tokenHash,
      tokenPrefix: "vbb_live_aaaa", modelId: "m", currencyCode: "USD", identifier: "clickId",
    });

    // Acme's key is valid and their workspace active. It reaches nothing of
    // Northridge's.
    expect((await feedInWorkspace(feeds, theirs.id, acme)).ok).toBe(false);

    const { client } = fakeSupabase();
    const overview = await buildOverview(acme, {
      feeds,
      connections: new CrmConnectionStore(client, ENCRYPTION_KEY),
      runs: new InMemorySyncRunStore(),
      now: NOW,
    });

    expect(overview.feed).toBeNull();
    expect(overview.actions[0].action).toMatch(/publish a feed/i);
  });
});
