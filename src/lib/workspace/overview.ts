import type { FeedRecord, FeedIdentifier } from "@/lib/feed/types";
import type { FeedRepository } from "@/lib/feed/repository";
import type { CrmConnectionStore } from "@/lib/sync/connections";
import { runHealth, type RunHealth, type SyncRun, type SyncRunStore } from "@/lib/sync/runs";
import type { SavedValueModel } from "@/lib/model/savedModel";
import type { Workspace } from "./repository";

/**
 * Everything one customer's page shows, and everything it should say to do.
 *
 * Written for a non-technical operator answering "is this customer working?"
 * That question has about eight parts, and until now each lived in a different
 * table with no screen reading any of them. Assembling it in one place means
 * the page renders an answer rather than deriving one.
 *
 * The important half is `actions`. Status without a next step just moves the
 * confusion: an operator who reads "currency mismatch" and does not know what
 * to do about it is no better off than one who read nothing. Every problem
 * here carries the fix, and says plainly when the fix is "get the developer".
 */

export type Severity = "blocked" | "attention" | "info";

export interface ActionItem {
  severity: Severity;
  /** What is wrong, in the advertiser's terms. */
  title: string;
  /** What to do about it. Never empty. */
  action: string;
  /** True when this is not something the operator can fix. */
  developer?: boolean;
}

export interface FeedSummary {
  id: string;
  tokenPrefix: string;
  identifier: FeedIdentifier;
  currencyCode: string;
  status: "active" | "revoked";
  rowsPublished: number;
  publishedAt: Date | null;
  createdAt: Date;
  lastFetchedAt: Date | null;
  lastFetchStatus: number | null;
  fetchesLast24h: number;
}

export interface ModelSummary {
  modelId: string;
  fittedAt: Date | null;
  fittedOn: number;
  currencyCode: string;
  factorCount: number;
  hasGate: boolean;
  gateStage: string | null;
}

export interface ConnectionSummary {
  connected: boolean;
  provider: string | null;
  /** "private-app" or the OAuth scopes, so an operator can tell them apart. */
  scopes: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  /** Set when the stored credential could not be read at all. */
  unreadable: string | null;
}

export interface WorkspaceOverview {
  workspace: { name: string; keyPrefix: string; status: string; createdAt: Date };
  feed: FeedSummary | null;
  model: ModelSummary | null;
  connection: ConnectionSummary;
  runs: SyncRun[];
  health: RunHealth;
  actions: ActionItem[];
  /** True when nothing is wrong and values are reaching Google. */
  working: boolean;
}

/** Google is expected daily; three days of silence is not a slow day. */
const FETCH_STALE_HOURS = 72;
const RUNS_SHOWN = 10;

export interface OverviewSources {
  feeds: FeedRepository;
  connections: CrmConnectionStore;
  runs: SyncRunStore;
  now?: Date;
}

export async function buildOverview(
  workspace: Workspace,
  sources: OverviewSources
): Promise<WorkspaceOverview> {
  const now = sources.now ?? new Date();

  // The newest active feed is the live one. Older feeds exist after a rotation
  // and are not what anyone is asking about.
  const allFeeds = await sources.feeds.listForWorkspace(workspace.id);
  const feed = allFeeds.find((f) => f.status === "active") ?? allFeeds[0] ?? null;

  const [feedSummary, model, connection, runs] = await Promise.all([
    feed ? summariseFeed(feed, sources.feeds, now) : Promise.resolve(null),
    feed ? summariseModel(feed, sources.feeds) : Promise.resolve(null),
    // Not conditional on a feed any more. A customer can connect HubSpot at
    // step 2 and publish later, and an Overview that reported "no CRM" until
    // they published would be telling them the opposite of what is true.
    summariseConnection(workspace.id, sources.connections),
    sources.runs.recentForWorkspace(workspace.id, RUNS_SHOWN),
  ]);

  const health = runHealth(runs, now);
  const actions = decideActions({ feed: feedSummary, model, connection, health, now });

  return {
    workspace: {
      name: workspace.name,
      keyPrefix: workspace.keyPrefix,
      status: workspace.status,
      createdAt: workspace.createdAt,
    },
    feed: feedSummary,
    model,
    connection,
    runs,
    health,
    actions,
    working: actions.every((a) => a.severity === "info"),
  };
}

// ---------------------------------------------------------------------------

async function summariseFeed(
  feed: FeedRecord,
  feeds: FeedRepository,
  now: Date
): Promise<FeedSummary> {
  const fetches = await feeds.recentFetches(feed.id, 20);
  const lastSuccess = fetches.find((f) => f.status === 200) ?? null;
  const since = new Date(now.getTime() - 86_400_000);

  return {
    id: feed.id,
    tokenPrefix: feed.tokenPrefix,
    identifier: feed.identifier,
    currencyCode: feed.currencyCode,
    status: feed.status,
    rowsPublished: feed.rowsPublished,
    publishedAt: feed.publishedAt,
    createdAt: feed.createdAt,
    lastFetchedAt: lastSuccess?.fetchedAt ?? null,
    lastFetchStatus: fetches[0]?.status ?? null,
    fetchesLast24h: fetches.filter((f) => f.fetchedAt > since).length,
  };
}

async function summariseModel(
  feed: FeedRecord,
  feeds: FeedRepository
): Promise<ModelSummary | null> {
  const { model } = await feeds.modelFor(feed.id);
  if (!model) return null;
  return describeModel(model);
}

export function describeModel(model: SavedValueModel): ModelSummary {
  return {
    modelId: model.modelId,
    fittedAt: model.fittedAt ? new Date(model.fittedAt) : null,
    fittedOn: model.fittedOn,
    currencyCode: model.currencyCode,
    factorCount: model.factors.length,
    hasGate: !!model.gate,
    gateStage: model.gate?.stage ?? null,
  };
}

function noConnection(): ConnectionSummary {
  return {
    connected: false, provider: null, scopes: null,
    lastSyncAt: null, lastSyncStatus: null, lastSyncError: null, unreadable: null,
  };
}

async function summariseConnection(
  workspaceId: string,
  connections: CrmConnectionStore
): Promise<ConnectionSummary> {
  const { connection, error } = await connections.load(workspaceId);
  if (!connection) {
    return {
      ...noConnection(),
      // "No CRM connected" is a normal state, not a fault. A credential that
      // exists and cannot be read is a fault, and they must not look alike.
      unreadable: error && !/no CRM connected/i.test(error) ? error : null,
    };
  }
  return {
    connected: true,
    provider: connection.provider,
    scopes: connection.scopes,
    lastSyncAt: connection.lastSyncAt,
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncError: connection.lastSyncError,
    unreadable: null,
  };
}

// ---------------------------------------------------------------------------
// What to do about it
// ---------------------------------------------------------------------------

interface Decidable {
  feed: FeedSummary | null;
  model: ModelSummary | null;
  connection: ConnectionSummary;
  health: RunHealth;
  now: Date;
}

/**
 * Ordered worst-first, because an operator reads the top of a list.
 *
 * Each entry answers both questions at once — what is wrong and what to do —
 * and marks the ones that are not the operator's to fix. Escalating everything
 * wastes a developer; escalating nothing strands the operator.
 */
export function decideActions(state: Decidable): ActionItem[] {
  const { feed, model, connection, health, now } = state;
  const items: ActionItem[] = [];

  if (!feed) {
    return [{
      severity: "blocked",
      title: "No feed has been published yet.",
      action: "Run the diagnostic with this customer's CRM export and publish a feed. Nothing reaches Google until that exists.",
    }];
  }

  if (feed.status === "revoked") {
    items.push({
      severity: "blocked",
      title: "This feed has been revoked.",
      action: "Google can no longer collect from it. Publish a new feed and paste the new URL into their Google Ads data source.",
    });
  }

  if (!model) {
    items.push({
      severity: "blocked",
      title: "No saved model is attached to this feed.",
      action: "The nightly sync cannot price anything without one. Re-publish from the diagnostic, which saves the model alongside the feed.",
    });
  }

  if (model && feed.currencyCode !== model.currencyCode) {
    // Values would be wrong by an exchange rate and look entirely plausible.
    items.push({
      severity: "blocked",
      title: `The model is fitted in ${model.currencyCode} but the feed reports ${feed.currencyCode}.`,
      action: `Every value would be wrong by the exchange rate. Re-run the diagnostic with the reporting currency set to ${model.currencyCode}, or refit in ${feed.currencyCode}.`,
    });
  }

  if (connection.unreadable) {
    items.push({
      severity: "blocked",
      title: "The stored CRM credentials cannot be read.",
      action: "Ask the customer to reconnect HubSpot from their workspace page. Nothing was lost; the credential simply cannot be decrypted.",
    });
  } else if (!connection.connected) {
    items.push({
      severity: "attention",
      title: "No CRM is connected.",
      action: "The feed only updates when someone publishes by hand. Connect HubSpot to have it refresh itself nightly.",
    });
  } else if (connection.lastSyncStatus === "refused" && connection.lastSyncError) {
    items.push({
      severity: /reconnect/i.test(connection.lastSyncError) ? "blocked" : "attention",
      title: "The last sync did not complete.",
      action: connection.lastSyncError,
    });
  }

  if (health.state === "overdue") {
    items.push({
      severity: "blocked",
      title: health.message,
      action: health.action ?? "Escalate to the developer.",
      developer: true,
    });
  } else if (health.state === "never-run" && connection.connected) {
    items.push({
      severity: "attention",
      title: "The nightly sync has not run yet.",
      action: health.action ?? "Wait for tonight's run.",
    });
  } else if (health.state === "failing") {
    items.push({
      severity: "attention",
      title: "The last nightly run did not complete.",
      action: health.message,
    });
  }

  // Google fetching is the only proof values are arriving. Everything upstream
  // can be perfect while this is silent.
  if (feed.status === "active") {
    if (!feed.lastFetchedAt) {
      items.push({
        severity: "attention",
        title: "Google has never collected this feed.",
        action: "Check the HTTPS data source is saved in their Google Ads account and the URL ends in .csv. A wait of up to a day after saving is normal.",
      });
    } else {
      const hours = (now.getTime() - feed.lastFetchedAt.getTime()) / 3_600_000;
      if (hours > FETCH_STALE_HOURS) {
        items.push({
          severity: "blocked",
          title: `Google last collected this feed ${Math.floor(hours / 24)} days ago.`,
          action: "Values have stopped reaching the account. Check the data source still exists in Google Ads and has not been paused.",
        });
      }
    }
  }

  if (items.length === 0) {
    items.push({
      severity: "info",
      title: "Everything is working.",
      action: `Google last collected ${feed.rowsPublished.toLocaleString()} rows. Values are reaching the account — check the campaign is on Maximize conversion value so it bids on them.`,
    });
  }

  const order: Record<Severity, number> = { blocked: 0, attention: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}
