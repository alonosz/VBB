import type { FeedRepository } from "@/lib/feed/repository";
import type { SavedValueModel } from "@/lib/model/savedModel";

/**
 * The model that is pricing this workspace's leads right now.
 *
 * The evaluation screen used to fit a fresh model on the live pull and score
 * both cohorts with that: a model with no audience, no discovered signals and
 * no overrides, which for a consumer file was flat and for any file was not
 * the yardstick the advertiser had saved and sent. The mix-shift check is
 * only honest against a fixed yardstick, and the fixed yardstick is the model
 * frozen with the feed (principle 8). This finds it: the newest active feed
 * with a stored model. A feed published without one cannot price and is
 * passed over.
 */
export interface LiveModel {
  model: SavedValueModel | null;
  feedId: string | null;
  /** Why there is none, when there is none. */
  reason: string | null;
}

export async function liveModelFor(feeds: FeedRepository, workspaceId: string): Promise<LiveModel> {
  const owned = await feeds.listForWorkspace(workspaceId);
  const active = owned.filter((f) => f.status === "active");
  if (active.length === 0) {
    return { model: null, feedId: null, reason: "Nothing has been published yet." };
  }
  let broken: string | null = null;
  for (const feed of active) {
    const { model, error } = await feeds.modelFor(feed.id);
    if (model) return { model, feedId: feed.id, reason: null };
    if (error) broken = broken ?? error;
  }
  return {
    model: null,
    feedId: null,
    reason: broken ?? "The feed was published without its model, so nothing here can be priced the way Google was told.",
  };
}
