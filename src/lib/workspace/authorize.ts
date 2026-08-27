import type { FeedRecord } from "@/lib/feed/types";
import type { FeedRepository } from "@/lib/feed/repository";
import { looksLikeFeedToken, looksLikeWorkspaceKey } from "./key";
import type { Workspace, WorkspaceRepository } from "./repository";

/**
 * The check every authorised route starts with.
 *
 * One function rather than a check per route, because the failure that matters
 * is the one somebody forgets to write. A route either calls this or it is
 * public, and which one it is is visible at a glance.
 *
 * Refusals say what to do rather than what went wrong. "Not found" is correct
 * and useless; an operator supporting five customers needs to know whether the
 * key is wrong, the workspace is suspended, or the feed belongs to someone
 * else — and a customer who pasted their feed URL into the key box needs to be
 * told that, because both credentials arrive in the same email.
 */

export interface Authorized {
  ok: true;
  workspace: Workspace;
}

export interface Refused {
  ok: false;
  status: number;
  error: string;
}

export type AuthResult = Authorized | Refused;

function refuse(status: number, error: string): Refused {
  return { ok: false, status, error };
}

export async function authorizeWorkspace(
  repo: WorkspaceRepository,
  presented: unknown
): Promise<AuthResult> {
  const key = typeof presented === "string" ? presented.trim() : "";

  if (!key) {
    return refuse(401, "This needs your workspace key. It starts with vbb_ws_ and was given to you when your workspace was set up.");
  }

  if (looksLikeFeedToken(key)) {
    return refuse(
      401,
      "That is your feed URL, which is the link Google reads. This needs your workspace key instead — the one starting vbb_ws_."
    );
  }

  if (!looksLikeWorkspaceKey(key)) {
    return refuse(401, "That does not look like a workspace key. It starts with vbb_ws_.");
  }

  const workspace = await repo.findByKey(key);
  if (!workspace) {
    return refuse(401, "That workspace key was not recognised. Check it was copied whole.");
  }

  if (workspace.status !== "active") {
    return refuse(403, "This workspace is suspended. Contact support to reactivate it.");
  }

  return { ok: true, workspace };
}

/**
 * That a feed belongs to the workspace that just authorised.
 *
 * Separate from the key check because they fail for different reasons and a
 * caller has to handle both: a valid key pointed at someone else's feed is not
 * an authentication problem, it is the isolation boundary doing its job.
 */
export async function feedInWorkspace(
  feeds: FeedRepository,
  feedId: string,
  workspace: Workspace
): Promise<{ ok: true; feed: FeedRecord } | Refused> {
  const feed = await feeds.findById(feedId);

  // Same answer whether the feed is missing or someone else's: a valid key
  // must not be usable to discover which feed ids exist.
  if (!feed || feed.clientId !== workspace.id) {
    return refuse(404, "No feed found in this workspace.");
  }

  return { ok: true, feed };
}
