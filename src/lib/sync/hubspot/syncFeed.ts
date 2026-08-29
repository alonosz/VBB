import type { FeedRepository } from "@/lib/feed/repository";
import { runSync, type SyncReport } from "../run";
import type { SyncRunStore } from "../runs";
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
  /** Where the run is recorded. A run with no record is an invisible run. */
  runs?: SyncRunStore;
  repo: FeedRepository;
  connections: CrmConnectionStore;
  /**
   * Absent when the deployment has no OAuth app configured — a portal
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

  const { connection, error: connectionError } = await connections.load(feedId);
  if (!connection) {
    const why = connectionError ?? "No CRM is connected.";
    await connections.recordRun(feedId, { status: "refused", error: why, at: now });
    await record("refused", why);
    return failed(feedId, why);
  }

  const { model, error: modelError } = await repo.modelFor(feedId);
  if (!model) {
    const why = modelError ?? "This feed has no saved model, so nothing can be priced.";
    await connections.recordRun(feedId, { status: "refused", error: why, at: now });
    await record("refused", why);
    return failed(feedId, why);
  }

  // Refreshed and stored before anything else uses it. HubSpot rotates the
  // refresh token on use, so losing the new one costs the connection.
  let accessToken = connection.accessToken;
  if (oauth && needsRefresh(connection.expiresAt, now) && connection.refreshToken) {
    const refreshed = await refreshAccessToken(oauth, connection.refreshToken, fetchImpl, now);
    if (!refreshed) {
      const why = "HubSpot would not renew the connection. Reconnect the account.";
      await connections.recordRun(feedId, { status: "refused", error: why, at: now });
      await record("refused", why);
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
    await connections.recordRun(feedId, { status: "failed", error: why, at: now });
    await record("failed", why);
    return failed(feedId, why);
  }

  const report = await runSync({ repo, feed, model, deals, now });

  await connections.recordRun(feedId, {
    status: report.refusedBecause ? "refused" : "ok",
    rows: report.rowsAdded,
    error: report.refusedBecause,
    at: now,
  });
  await record(report.refusedBecause ? "refused" : "ok", report.refusedBecause, report);

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
