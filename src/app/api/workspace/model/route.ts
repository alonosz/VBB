import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";
import { liveModelFor } from "@/lib/workspace/liveModel";

/**
 * The model frozen with this workspace's live feed, for the screens that
 * must price leads exactly as Google was told they were priced.
 *
 * A saved model is the advertiser's own aggregates over their own deals:
 * multipliers, a base value, level labels. It carries no record, no name and
 * no address (the database refuses one that does), so returning it to the
 * key holder gives away nothing the report did not already show them.
 */

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: Request) {
  const workspaces = workspaceRepositoryFromEnv();
  const feeds = feedRepositoryFromEnv();
  if (!workspaces || !feeds) return bad("This deployment has no workspace store configured.", 503);

  const key = new URL(request.url).searchParams.get("workspaceKey") ?? "";
  const auth = await authorizeWorkspace(workspaces, key);
  if (!auth.ok) return bad(auth.error, auth.status);

  const live = await liveModelFor(feeds, auth.workspace.id);
  return NextResponse.json({ ok: true, model: live.model, feedId: live.feedId, reason: live.reason });
}
