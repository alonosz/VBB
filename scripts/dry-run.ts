/**
 * The whole journey against synthetic data, printed.
 *
 * The golden-path test asserts this; this prints it. A checklist claiming
 * "verified end to end" is worth what the reader can see, so PILOT_READINESS
 * carries this output rather than the claim.
 *
 *   npx tsx scripts/dry-run.ts
 *
 * Touches no network and no database - in-memory throughout.
 */

import { InMemoryWorkspaceRepository } from "../src/lib/workspace/repository";
import { generateWorkspaceKey } from "../src/lib/workspace/key";
import { authorizeWorkspace, feedInWorkspace } from "../src/lib/workspace/authorize";
import { buildOverview } from "../src/lib/workspace/overview";
import { InMemoryFeedRepository } from "../src/lib/feed/repository";
import { publishFeed, serveFeed } from "../src/lib/feed/handlers";
import { buildFeedRows, identifiersFor } from "../src/lib/feed/publish";
import { CrmConnectionStore } from "../src/lib/sync/connections";
import { InMemorySyncRunStore } from "../src/lib/sync/runs";
import { fakeSupabase } from "../src/lib/sync/fakeSupabase";
import { generateKey, parseKey } from "../src/lib/sync/secrets";
import { syncFeed } from "../src/lib/sync/hubspot/syncFeed";
import { generateDemoDeals } from "../src/lib/fixtures/demoDataset";
import { runDiagnostic } from "../src/lib/analysis";
import { valueAllLeads, withOverrides } from "../src/lib/analysis/valueModel";
import { saveValueModel } from "../src/lib/model/savedModel";

const NOW = new Date();
const ORIGIN = "https://vbb.example";

function step(n: number, title: string) {
  console.log(`\n${"─".repeat(64)}\n${n}. ${title}\n${"─".repeat(64)}`);
}
function line(label: string, value: string | number) {
  console.log(`   ${label.padEnd(34)} ${value}`);
}

function hubspotPortal(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/deals/search")) {
      return new Response(JSON.stringify({ results: [{
        id: "d-new",
        properties: {
          createdate: new Date(NOW.getTime() - 2 * 86400000).toISOString(),
          dealstage: "stage-2", amount: "8200", hs_is_closed: "false",
        },
      }] }));
    }
    if (path === "/crm/v4/associations/deals/contacts/batch/read") {
      return new Response(JSON.stringify({ results: [{ from: { id: "d-new" }, to: [{ toObjectId: "c1" }] }] }));
    }
    if (path === "/crm/v4/associations/deals/companies/batch/read") {
      return new Response(JSON.stringify({ results: [{ from: { id: "d-new" }, to: [{ toObjectId: "co1" }] }] }));
    }
    if (path === "/crm/v3/objects/contacts/batch/read") {
      return new Response(JSON.stringify({ results: [{ id: "c1", properties: {
        email: "dana.k@northridgefab.com", jobtitle: "Operations Manager", gclid: "Cj0KCQdryrun00001",
      } }] }));
    }
    return new Response(JSON.stringify({ results: [{ id: "co1", properties: {
      numberofemployees: "420", industry: "Manufacturing",
    } }] }));
  }) as unknown as typeof fetch;
}

async function main() {
  console.log("VBB Engine - dry run against synthetic data");
  console.log(`Started ${NOW.toISOString()}`);

  step(1, "Operator creates a workspace");
  const workspaces = new InMemoryWorkspaceRepository(() => NOW);
  const generated = await generateWorkspaceKey();
  const workspace = await workspaces.create({ name: "Northridge Fabrication", keyHash: generated.keyHash, keyPrefix: generated.keyPrefix });
  const auth = await authorizeWorkspace(workspaces, generated.key);
  if (!auth.ok) throw new Error(auth.error);
  line("workspace", auth.workspace.name);
  line("key prefix", `${auth.workspace.keyPrefix}…`);
  line("key stored as", "SHA-256 hash only");

  step(2, "Customer's export is analysed");
  const deals = generateDemoDeals();
  const diagnostic = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: NOW });
  line("deals in export", deals.length);
  line("verdict", diagnostic.verdict.mode);
  line("base value", `$${diagnostic.valueModel.baseValue}`);
  line("rules fitted", diagnostic.valueModel.includedFactors.map((f) => f.key).join(", "));
  line("rules dropped", diagnostic.valueModel.droppedFactors.length);
  line("early gate", diagnostic.gate?.available ? `${diagnostic.gate.stage} ×${diagnostic.gate.multiplier}` : "none");

  step(3, "Model approved and frozen");
  const applied = withOverrides(diagnostic.valueModel, deals, {});
  const artifact = saveValueModel(applied, { deals, modelId: "model-dryrun", gate: diagnostic.gate, now: NOW });
  line("model id", artifact.modelId);
  line("fitted on", `${artifact.fittedOn} resolved deals`);
  line("size", `${JSON.stringify(artifact).length} bytes`);
  line("contains an '@'", JSON.stringify(artifact).includes("@") ? "YES - PROBLEM" : "no");

  step(4, "Feed published");
  const feeds = new InMemoryFeedRepository(() => NOW);
  const valued = valueAllLeads(deals, applied);
  const identifier = identifiersFor(valued).identifier;
  const { rows, newConversions, skipped } = await buildFeedRows({
    leads: valued, modelId: artifact.modelId, currencyCode: "USD", identifier, gate: diagnostic.gate, now: NOW,
  });
  const published = await publishFeed(feeds, {
    modelId: artifact.modelId, currencyCode: "USD", identifier,
    rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
    model: artifact,
  }, ORIGIN, auth.workspace.id);
  const body = JSON.parse(published.body) as Record<string, unknown>;
  const feedId = body.feedId as string;
  const feedUrl = body.feedUrl as string;
  line("status", published.status);
  line("identifier", identifier);
  line("rows published", newConversions);
  line("skipped", skipped.map((s) => `${s.count} (${s.reason})`).join("; ") || "none");
  line("model stored", String(body.modelStored));
  line("URL ends in .csv", feedUrl.endsWith(".csv") ? "yes" : "NO - PROBLEM");

  step(5, "Isolation checked");
  const other = await generateWorkspaceKey();
  const acme = await workspaces.create({ name: "Acme", keyHash: other.keyHash, keyPrefix: other.keyPrefix });
  const crossed = await feedInWorkspace(feeds, feedId, acme);
  line("another workspace reaches this feed", crossed.ok ? "YES - PROBLEM" : "no");
  line("answer given", crossed.ok ? "-" : `${crossed.status} ${crossed.error}`);

  step(6, "CRM connected");
  const { client, rows: connRows } = fakeSupabase();
  const connections = new CrmConnectionStore(client, parseKey(generateKey())!);
  await connections.save({
    workspaceId: workspace.id, provider: "hubspot", accessToken: "portal-token-placeholder",
    refreshToken: null, expiresAt: null, scopes: "private-app",
  });
  line("stored", "yes");
  line("plaintext token in row", JSON.stringify([...connRows.values()]).includes("portal-token-placeholder") ? "YES - PROBLEM" : "no");

  step(7, "Nightly sync runs unattended");
  const runs = new InMemorySyncRunStore();
  const before = (await feeds.rowsFor(feedId)).length;
  const outcome = await syncFeed({ feedId, repo: feeds, connections, runs, fetchImpl: hubspotPortal(), now: NOW });
  const after = await feeds.rowsFor(feedId);
  line("result", outcome.error ?? "ok");
  line("deals pulled", outcome.report?.dealsPulled ?? 0);
  line("rows before / after", `${before} / ${after.length}`);
  line("run recorded", `${runs.runs.length} (status ${runs.runs[0]?.status})`);
  line("priced by", after.find((r) => r.modelId !== artifact.modelId) ? "MIXED - PROBLEM" : artifact.modelId);

  step(8, "Google collects the file");
  const token = new URL(feedUrl).pathname.split("/").pop()!.replace(/\.csv$/, "");
  const served = await serveFeed(feeds, { token, ip: "66.249.66.1", userAgent: "Google-Ads", now: NOW });
  const csv = served.body;
  line("status", served.status);
  line("content type", served.headers["content-type"]);
  line("rows in file", csv.trim().split("\n").length - 1);
  line("contains an email address", /[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(csv) ? "YES - PROBLEM" : "no");
  line("contains a job title", csv.includes("Operations Manager") ? "YES - PROBLEM" : "no");

  step(9, "Workspace page reports");
  const overview = await buildOverview(auth.workspace, { feeds, connections, runs, now: NOW });
  line("feed", overview.feed ? `${overview.feed.status}, ${overview.feed.rowsPublished} rows` : "none");
  line("model", overview.model ? `${overview.model.modelId}, ${overview.model.factorCount} rules` : "none");
  line("CRM", overview.connection.connected ? "connected" : "not connected");
  line("last Google fetch", overview.feed?.lastFetchedAt ? "recorded" : "never");
  line("run health", overview.health.state);
  line("working", String(overview.working));
  line("top message", overview.actions[0].title);

  console.log(`\n${"─".repeat(64)}`);
  console.log(overview.working ? "DRY RUN PASSED - the journey completes end to end." : "DRY RUN FAILED");
  console.log(`${"─".repeat(64)}\n`);
  if (!overview.working) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
