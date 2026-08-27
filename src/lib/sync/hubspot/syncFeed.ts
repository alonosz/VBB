import type { FeedRepository } from "@/lib/feed/repository";
import { runSync, type SyncReport } from "../run";
import { CrmConnectionStore } from "../connections";
import { HubSpotClient, HubSpotError, pullFromHubSpot } from "./client";
import { hubspotToDeals } from "./map";
import {
  needsRefresh,
  refreshAccessToken,
  type OAuthConfig,
} from "./oauth";

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
  repo: FeedRepository;
  connections: CrmConnectionStore;
  oauth: OAuthConfig;
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
  const { feedId, repo, connections, oauth } = opts;
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;

  const feed = await repo.findById(feedId);
  if (!feed) return failed(feedId, "This feed no longer exists.");
  if (feed.status !== "active") {
    return failed(feedId, "This feed has been revoked, so nothing was pulled.");
  }

  const { connection, error: connectionError } = await connections.load(feedId);
  if (!connection) {
    await connections.recordRun(feedId, { status: "refused", error: connectionError, at: now });
    return failed(feedId, connectionError ?? "No CRM is connected.");
  }

  const { model, error: modelError } = await repo.modelFor(feedId);
  if (!model) {
    const why = modelError ?? "This feed has no saved model, so nothing can be priced.";
    await connections.recordRun(feedId, { status: "refused", error: why, at: now });
    return failed(feedId, why);
  }

  // Refreshed and stored before anything else uses it. HubSpot rotates the
  // refresh token on use, so losing the new one costs the connection.
  let accessToken = connection.accessToken;
  if (needsRefresh(connection.expiresAt, now) && connection.refreshToken) {
    const refreshed = await refreshAccessToken(oauth, connection.refreshToken, fetchImpl, now);
    if (!refreshed) {
      const why = "HubSpot would not renew the connection. Reconnect the account.";
      await connections.recordRun(feedId, { status: "refused", error: why, at: now });
      return failed(feedId, why);
    }
    await connections.save({
      feedId,
      provider: "hubspot",
      externalAccountId: connection.externalAccountId,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? connection.refreshToken,
      expiresAt: refreshed.expiresAt,
      scopes: connection.scopes,
    });
    accessToken = refreshed.accessToken;
  }

  let deals;
  try {
    const client = new HubSpotClient({
      accessToken,
      fetchImpl,
      now,
      windowDays: opts.windowDays,
      sleep: opts.sleep,
    });
    // CRM records exist here and nowhere else — in memory, for the length of
    // this call. Only feed rows are written down.
    deals = hubspotToDeals(await pullFromHubSpot(client));
  } catch (error) {
    const why =
      error instanceof HubSpotError
        ? error.message
        : "The CRM could not be read. Nothing was published; the next run will pick these up.";
    await connections.recordRun(feedId, { status: "failed", error: why, at: now });
    return failed(feedId, why);
  }

  const report = await runSync({ repo, feed, model, deals, now });

  await connections.recordRun(feedId, {
    status: report.refusedBecause ? "refused" : "ok",
    rows: report.rowsAdded,
    error: report.refusedBecause,
    at: now,
  });

  return { feedId, report, error: report.refusedBecause };
}

/**
 * Every connected feed, one run each.
 *
 * One feed's failure must not stop the rest: a portal that revoked access
 * should not cost every other advertiser their night.
 */
export async function syncAllFeeds(
  opts: Omit<SyncFeedOptions, "feedId">
): Promise<FeedSyncOutcome[]> {
  const feedIds = await opts.connections.connectedFeedIds();
  const outcomes: FeedSyncOutcome[] = [];

  for (const feedId of feedIds) {
    try {
      outcomes.push(await syncFeed({ ...opts, feedId }));
    } catch (error) {
      console.error(`sync failed for feed ${feedId}:`, error);
      outcomes.push(failed(feedId, "The run failed unexpectedly."));
    }
  }

  return outcomes;
}
