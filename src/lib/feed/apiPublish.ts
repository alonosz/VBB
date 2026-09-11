import type { FeedRepository } from "./repository";
import type { FeedIdentifier, FeedRecord, FeedRow } from "./types";
import type { SavedValueModel } from "@/lib/model/savedModel";
import { generateFeedToken } from "./token";

/**
 * A send through the Google Ads connection, kept.
 *
 * Until this existed the API route sent the rows and remembered nothing: no
 * model on the server, no record of which leads went. That was fine for a
 * one-off and useless for anything after it - the nightly run had no model
 * to price the next lead with, and a webhook would have had nowhere to put
 * one. So a send is now stored the way a published URL is: a feed, its rows,
 * and the frozen model that priced them, marked `api` so the nightly run and
 * the webhook know to deliver rather than wait to be fetched.
 *
 * The rows arrive already sent, so they are marked delivered on the way in.
 * The token the feed carries is never revealed; it exists because a feed
 * has one, and nothing can fetch a feed nobody was handed the URL of.
 *
 * One API feed per workspace at a time. A resend from the browser replaces
 * the previous one, exactly as a republished URL does; the rows already at
 * Google stay at Google, and its deduplication on the transaction id is what
 * keeps a lead from counting twice across the two.
 */
export interface ApiPublish {
  clientId: string;
  rows: FeedRow[];
  modelId: string;
  currencyCode: string;
  model: SavedValueModel | null;
  now?: Date;
}

export interface ApiPublishOutcome {
  feed: FeedRecord;
  rowsStored: number;
  modelStored: boolean;
  /** Earlier API feeds of this workspace that were retired for this one. */
  replaced: number;
}

/** Read off the rows, as the URL route reads it off the file. */
export function identifierOfRows(rows: readonly FeedRow[]): FeedIdentifier {
  const clicks = rows.some((r) => r.clickId);
  const emails = rows.some((r) => r.hashedEmail);
  return clicks && emails ? "both" : emails ? "email" : "clickId";
}

export async function storeApiPublish(repo: FeedRepository, publish: ApiPublish): Promise<ApiPublishOutcome> {
  const now = publish.now ?? new Date();

  let replaced = 0;
  for (const existing of await repo.listForWorkspace(publish.clientId)) {
    if (existing.status === "active" && existing.delivery === "api") {
      await repo.revokeFeed(existing.id);
      replaced++;
    }
  }

  const { tokenHash, tokenPrefix } = await generateFeedToken();
  const feed = await repo.createFeed({
    clientId: publish.clientId,
    tokenHash,
    tokenPrefix,
    label: "Google Ads connection",
    modelId: publish.modelId,
    modelFittedAt: publish.model?.fittedAt ? new Date(publish.model.fittedAt) : null,
    currencyCode: publish.currencyCode,
    identifier: identifierOfRows(publish.rows),
    delivery: "api",
  });

  // Written as already at Google in the same insert. Two writes would leave
  // a window in which a run finds the whole send pending and sends it again.
  const rowsStored = await repo.addRows(feed.id, publish.rows, { deliveredAt: now });

  let modelStored = false;
  if (publish.model) {
    try {
      await repo.saveModel(feed.id, publish.model);
      modelStored = true;
    } catch (error) {
      // The rows are at Google and stored; what is lost is the ability to
      // price the next lead until the model is published again. Said, not
      // hidden.
      console.error("storing the model for an API send failed:", error);
    }
  }

  return { feed: { ...feed, rowsPublished: rowsStored }, rowsStored, modelStored, replaced };
}
