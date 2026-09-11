import type { FeedRepository } from "@/lib/feed/repository";
import type { FeedRecord, FeedRow } from "@/lib/feed/types";
import type { CrmConnectionStore } from "../connections";
import type { OAuthConfig } from "../oauth/tokens";
import { AdsApiError, AdsClient, credentialsFromEnv, type AdsCredentials } from "./client";
import { conversionActionFor } from "./conversionAction";
import { IngestError, conversionActionId, ingestEvents } from "./dataManager";
import { freshAccessToken } from "./accessToken";

/**
 * Sending an api feed's waiting rows to Google, with nobody in the browser.
 *
 * The publish route sends what a person just approved on screen. This sends
 * what the nightly run or the CRM webhook priced afterwards, against the
 * same account and the same conversion action, so a lead that arrived at
 * three in the afternoon is at Google at three in the afternoon and not the
 * next morning.
 *
 * A send that fails leaves every row pending. Nothing is marked delivered
 * on hope, and the next run - the next webhook, or the night's sweep -
 * sends the same rows again. Google's deduplication on the transaction id
 * is what makes a retry safe rather than a double count.
 */

export interface DeliveryOutcome {
  /** Rows Google accepted for processing this time. */
  sent: number;
  /** Rows still waiting after this attempt, refused ones included. */
  pending: number;
  /** Rows Google refused on their own this time. They are named as such and retried nightly. */
  failed: number;
  /** What went wrong, in words for the run log. Null when everything went. */
  error: string | null;
}

/** Rows per request. Google takes more; this keeps one refusal cheap to isolate. */
export const SEND_CHUNK = 500;

export interface GoogleSender {
  send(rows: FeedRow[]): Promise<void>;
}

export interface SenderDeps {
  credentials: (accessToken: string) => AdsCredentials | null;
  makeClient: (credentials: AdsCredentials) => AdsClient;
  resolveActionId: (client: AdsClient, customerId: string) => Promise<string | null>;
  ingest: typeof ingestEvents;
}

const LIVE_DEPS: SenderDeps = {
  credentials: credentialsFromEnv,
  makeClient: (credentials) => new AdsClient({ credentials }),
  resolveActionId: async (client, customerId) => {
    const lookup = await conversionActionFor(client, customerId, { dryRun: false });
    return lookup.pending ? null : conversionActionId(lookup.action.resourceName);
  },
  ingest: ingestEvents,
};

/**
 * A sender for one workspace, or the reason there cannot be one.
 *
 * The account is the one the workspace last sent to from the Connect step.
 * Nothing here picks an account: a run that chose one on its own would be a
 * run sending an advertiser's values somewhere they never approved.
 */
export async function googleSenderFor(opts: {
  workspaceId: string;
  connections: CrmConnectionStore;
  oauth: OAuthConfig | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  deps?: Partial<SenderDeps>;
}): Promise<{ sender: GoogleSender | null; error: string | null }> {
  const deps = { ...LIVE_DEPS, ...opts.deps };
  const fetchImpl = opts.fetchImpl ?? fetch;

  const loaded = await opts.connections.load(opts.workspaceId, "google_ads");
  if (!loaded.connection) {
    return { sender: null, error: loaded.error ?? "No Google Ads account is connected." };
  }
  const customerId = loaded.connection.externalAccountId;
  if (!customerId) {
    return {
      sender: null,
      error: "No Google Ads account has been chosen yet. Send the values once from the Connect step and the account is remembered.",
    };
  }

  const fresh = await freshAccessToken({
    connections: opts.connections,
    connection: loaded.connection,
    oauth: opts.oauth,
    fetchImpl,
    now: opts.now,
  });
  if (fresh.token === null) return { sender: null, error: fresh.error };

  const credentials = deps.credentials(fresh.token);
  if (!credentials) {
    return { sender: null, error: "Google Ads access is not configured on this deployment (developer token)." };
  }
  const client = deps.makeClient(credentials);
  const accessToken = fresh.token;

  return {
    error: null,
    sender: {
      async send(rows) {
        const actionId = await deps.resolveActionId(client, customerId);
        if (!actionId) throw new Error("The conversion action could not be found or created.");
        await deps.ingest({
          accessToken,
          operatingAccountId: customerId,
          conversionActionId: actionId,
          rows,
          fetchImpl,
        });
      },
    },
  };
}

/**
 * The Data Manager API accepts or refuses a request whole. So a batch is
 * sent as one request, and when Google refuses it each row is sent on its
 * own: the good ones go through, and the one Google will never take is
 * named as refused rather than left to poison every batch after it. The
 * live path skips a refused row; the nightly run tries it again, in case
 * what Google lacked yesterday - a click too fresh to be recorded - it has
 * today.
 */
export async function deliverPending(opts: {
  feed: FeedRecord;
  repo: FeedRepository;
  sender: GoogleSender;
  now?: Date;
  /** Include rows Google refused before. The nightly run's setting. */
  retryFailed?: boolean;
}): Promise<DeliveryOutcome> {
  const { feed, repo, sender } = opts;
  const now = opts.now ?? new Date();

  // A URL feed is collected, not sent. Its rows never become "delivered"
  // because we never learn that they were.
  if (feed.delivery !== "api") return { sent: 0, pending: 0, failed: 0, error: null };

  const pending = await repo.pendingRows(feed.id, { retryFailed: opts.retryFailed });
  if (pending.length === 0) {
    return { sent: 0, pending: await repo.countPending(feed.id), failed: 0, error: null };
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;

  for (let i = 0; i < pending.length; i += SEND_CHUNK) {
    const chunk = pending.slice(i, i + SEND_CHUNK);
    try {
      await sender.send(chunk);
      await repo.markDelivered(feed.id, chunk, now);
      sent += chunk.length;
      continue;
    } catch (error) {
      firstError ??= describeFailure(error);
    }

    // The batch was refused. Find out which rows Google actually objects to.
    for (const row of chunk) {
      try {
        await sender.send([row]);
        await repo.markDelivered(feed.id, [row], now);
        sent++;
      } catch (error) {
        const why = describeFailure(error);
        firstError ??= why;
        await repo.markFailed(feed.id, [row], why, now);
        failed++;
      }
    }
  }

  return {
    sent,
    pending: await repo.countPending(feed.id),
    failed,
    error: failed > 0 ? `${failed} ${failed === 1 ? "row" : "rows"} refused by Google: ${firstError}` : firstError,
  };
}

function describeFailure(error: unknown): string {
  if (error instanceof IngestError || error instanceof AdsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Sending to Google Ads failed.";
}
