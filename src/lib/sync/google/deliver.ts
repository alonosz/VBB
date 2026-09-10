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
  /** Rows still waiting after this attempt. */
  pending: number;
  /** Why nothing was sent, in words for the run log. */
  error: string | null;
}

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

export async function deliverPending(opts: {
  feed: FeedRecord;
  repo: FeedRepository;
  sender: GoogleSender;
  now?: Date;
}): Promise<DeliveryOutcome> {
  const { feed, repo, sender } = opts;
  const now = opts.now ?? new Date();

  // A URL feed is collected, not sent. Its rows never become "delivered"
  // because we never learn that they were.
  if (feed.delivery !== "api") return { sent: 0, pending: 0, error: null };

  const pending = await repo.pendingRows(feed.id);
  if (pending.length === 0) return { sent: 0, pending: 0, error: null };

  try {
    await sender.send(pending);
  } catch (error) {
    return { sent: 0, pending: pending.length, error: describeFailure(error) };
  }

  await repo.markDelivered(feed.id, pending, now);
  return { sent: pending.length, pending: 0, error: null };
}

function describeFailure(error: unknown): string {
  if (error instanceof IngestError || error instanceof AdsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Sending to Google Ads failed.";
}
