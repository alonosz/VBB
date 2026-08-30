import type { FeedRepository } from "@/lib/feed/repository";
import { runSync, type SyncReport } from "../run";
import type { SyncRunStore } from "../runs";
import { CrmConnectionStore } from "../connections";
import { HubSpotClient, HubSpotError, pullFromHubSpot } from "./client";
import { hubspotToDeals } from "./map";
import { type OAuthConfig } from "./oauth";
import { freshAccessToken } from "./accessToken";

/**
 * One feed's scheduled run, end to end.
 *
 * Everything that can go wrong here happens while nobody is watching, so the
 * shape of a failure matters as much as the success path: a run either
 * publishes rows or records a sentence explaining why it did not, and never
 * leaves the advertiser to infer it from an empty feed.
 *
 * A refreshed token is written back before the pull, not after. A run that
 * pulled successfully and then crashed would otherwise leave a token HubSpot
 * has already rotated away, turning one bad night into a permanent
 * disconnection.
 */

export interface SyncFeedOptions {
  feedId: string;
  /** Where the run is recorded. A run with no record is an invisible run. */
  runs?: SyncRunStore;
  repo: FeedRepository;
  connections: CrmConnectionStore;
  /**
   * Absent when the deployment has no OAuth app configured - a portal
   * connected with a private app token has nothing to refresh, so a run needs
   * no client credentials at all.
   */
  oauth?: OAuthConfig | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  windowDays?: number;
  /**
   * How the client waits between retries. Injected so a cron with a time
   * budget can bound it, and so tests do not spend fifteen real seconds
   * proving that a retry happens.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface FeedSyncOutcome {
  feedId: string;
  report: SyncReport | null;
  /** Present when the run could not get as far as pricing anything. */
  error: string | null;
}

function failed(feedId: string, error: string): FeedSyncOutcome {
  return { feedId, report: null, error };
}

export async function syncFeed(opts: SyncFeedOptions): Promise<FeedSyncOutcome> {
  const { feedId, repo, connections } = opts;
  const oauth = opts.oauth ?? null;
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;

  const feed = await repo.findById(feedId);

  /**
   * Every exit from here leaves a row. A run that refused and a run that never
   * happened look identical from outside otherwise, and they need opposite
   * responses.
   */
  const record = async (
    status: "ok" | "refused" | "failed",
    message: string | null,
    report: SyncReport | null = null
  ) => {
    await opts.runs?.record({
      feedId: feed?.id ?? null,
      clientId: feed?.clientId ?? null,
      status,
      startedAt: now,
      message,
      report,
    });
  };
  if (!feed) {
    await record("failed", "This feed no longer exists.");
    return failed(feedId, "This feed no longer exists.");
  }
  if (feed.status !== "active") {
    const why = "This feed has been revoked, so nothing was pulled.";
    await record("refused", why);
    return failed(feedId, why);
  }

  // The connection belongs to the customer, not this feed. The feed is loaded
  // above, so its owner is known by the time any of this runs.
  const workspaceId = feed.clientId;

  const { connection, error: connectionError } = await connections.load(workspaceId);
  if (!connection) {
    const why = connectionError ?? "No CRM is connected.";
    await connections.recordRun(workspaceId, { status: "refused", error: why, at: now });
    await record("refused", why);
    return failed(feedId, why);
  }

  const { model, error: modelError } = await repo.modelFor(feedId);
  if (!model) {
    const why = modelError ?? "This feed has no saved model, so nothing can be priced.";
    await connections.recordRun(workspaceId, { status: "refused", error: why, at: now });
    await record("refused", why);
    return failed(feedId, why);
  }

  // Refreshed and stored before anything else uses it. HubSpot rotates the
  // refresh token on use, so losing the new one costs the connection. Shared
  // with the step-2 history pull rather than copied, because two copies of
  // that rule is how one of them ends up not saving the new token.
  // Not destructured: the result is a discriminated union, and pulling the
  // two fields apart loses the narrowing that proves the error is a string
  // wherever the token is null.
  const fresh = await freshAccessToken({
    connections,
    connection,
    oauth: oauth ?? null,
    fetchImpl,
    now,
  });
  if (fresh.token === null) {
    await connections.recordRun(workspaceId, { status: "refused", error: fresh.error, at: now });
    await record("refused", fresh.error);
    return failed(feedId, fresh.error);
  }
  const accessToken = fresh.token;

  let deals;
  try {
    const client = new HubSpotClient({
      accessToken,
      fetchImpl,
      now,
      windowDays: opts.windowDays,
      sleep: opts.sleep,
    });
    // CRM records exist here and nowhere else - in memory, for the length of
    // this call. Only feed rows are written down.
    //
    // The feed declares one currency, so a deal booked in another is left
    // unpriced rather than counted as though it were the same money. Nobody
    // can set a rate at three in the morning, and a wrong amount that looks
    // right is worse than a missing one the report can show as excluded.
    deals = hubspotToDeals(await pullFromHubSpot(client), {
      reportingCurrency: feed.currencyCode,
      rates: {},
      excludeUnconvertible: true,
    });
  } catch (error) {
    const why =
      error instanceof HubSpotError
        ? error.message
        : "The CRM could not be read. Nothing was published; the next run will pick these up.";
    await connections.recordRun(workspaceId, { status: "failed", error: why, at: now });
    await record("failed", why);
    return failed(feedId, why);
  }

  const report = await runSync({ repo, feed, model, deals, now });

  await connections.recordRun(workspaceId, {
    status: report.refusedBecause ? "refused" : "ok",
    rows: report.rowsAdded,
    error: report.refusedBecause,
    at: now,
  });
  await record(report.refusedBecause ? "refused" : "ok", report.refusedBecause, report);

  return { feedId, report, error: report.refusedBecause };
}

/**
 * Every live feed belonging to a connected customer, one run each.
 *
 * A connection hangs off the customer now, so the walk is customer → their
 * feeds rather than straight down a list of feeds. Every active feed they own
 * is refreshed: each carries its own rows and its own frozen model, and a live
 * feed Google is still collecting from should not go stale because a newer one
 * exists beside it. `syncFeed` skips anything not active.
 *
 * One failure must not stop the rest - a portal that revoked access should not
 * cost every other advertiser their night.
 */
export async function syncAllFeeds(
  opts: Omit<SyncFeedOptions, "feedId">
): Promise<FeedSyncOutcome[]> {
  const workspaceIds = await opts.connections.connectedWorkspaceIds();

  const feedIds: string[] = [];
  for (const workspaceId of workspaceIds) {
    const feeds = await opts.repo.listForWorkspace(workspaceId);
    for (const feed of feeds) {
      if (feed.status === "active") feedIds.push(feed.id);
    }
  }

  const outcomes: FeedSyncOutcome[] = [];

  for (const feedId of feedIds) {
    try {
      outcomes.push(await syncFeed({ ...opts, feedId }));
    } catch (error) {
      console.error(`sync failed for feed ${feedId}:`, error);
      const why = "The run failed unexpectedly.";
      // syncFeed threw before it could record anything, so this is the only
      // trace the run will leave.
      await opts.runs?.record({
        feedId, clientId: null, status: "failed", startedAt: opts.now ?? new Date(), message: why,
      });
      outcomes.push(failed(feedId, why));
    }
  }

  return outcomes;
}
