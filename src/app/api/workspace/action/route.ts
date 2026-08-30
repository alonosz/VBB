import { NextResponse } from "next/server";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace, feedInWorkspace } from "@/lib/workspace/authorize";
import { generateFeedToken } from "@/lib/feed/token";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { keyFromEnv } from "@/lib/sync/secrets";

/**
 * The three things support has to be able to do without SQL.
 *
 * All of them existed in the repository layer with no route calling them,
 * which made a lost feed URL or a CRM that needed disconnecting a developer's
 * afternoon. They share one endpoint so the authorisation happens once, in a
 * place it is obvious to check.
 *
 * Every action is authorised by the workspace key and then checked against the
 * feed's owner. A valid key for one customer must not reach another's feed,
 * whatever it asks for.
 */

export const runtime = "nodejs";

type Action = "rotate-token" | "revoke-feed" | "disconnect-crm";
const ACTIONS: Action[] = ["rotate-token", "revoke-feed", "disconnect-crm"];

export async function POST(request: Request) {
  const feeds = feedRepositoryFromEnv();
  const workspaces = workspaceRepositoryFromEnv();
  const client = supabaseFromEnv();

  if (!feeds || !workspaces || !client) {
    return NextResponse.json({ ok: false, error: "This deployment is not set up yet." }, { status: 503 });
  }

  let body: { workspaceKey?: unknown; action?: unknown; feedId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const auth = await authorizeWorkspace(workspaces, body.workspaceKey);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const action = ACTIONS.find((a) => a === body.action);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const feedId = typeof body.feedId === "string" ? body.feedId : "";
  const owned = await feedInWorkspace(feeds, feedId, auth.workspace);
  if (!owned.ok) {
    return NextResponse.json({ ok: false, error: owned.error }, { status: owned.status });
  }
  const feed = owned.feed;

  if (action === "rotate-token") {
    if (feed.status !== "active") {
      return NextResponse.json(
        { ok: false, error: "This feed is revoked. Publish a new one instead." },
        { status: 409 }
      );
    }

    // Rotating keeps the rows, the model and the record of what Google already
    // has. Republishing would lose that and resend every conversion.
    const generated = await generateFeedToken();
    await feeds.rotateToken(feed.id, generated.tokenHash, generated.tokenPrefix);
    const origin = feedOriginFromEnv(new URL(request.url).origin);

    return NextResponse.json({
      ok: true,
      action,
      feedUrl: `${origin}/v1/feeds/google-ads/${generated.token}.csv`,
      message:
        "The old feed URL has stopped working. Paste this new one into the Google Ads data source now - until you do, Google cannot collect.",
    });
  }

  if (action === "revoke-feed") {
    await feeds.revokeFeed(feed.id);
    return NextResponse.json({
      ok: true,
      action,
      message:
        "This feed is revoked and Google can no longer collect from it. Rows already sent stay in their account; nothing new arrives until a new feed is published.",
    });
  }

  const encryptionKey = keyFromEnv();
  if (!encryptionKey) {
    return NextResponse.json(
      { ok: false, error: "CRM connections are not configured on this deployment." },
      { status: 503 }
    );
  }

  await new CrmConnectionStore(client, encryptionKey).disconnect(auth.workspace.id, "hubspot");
  return NextResponse.json({
    ok: true,
    action,
    message:
      "HubSpot is disconnected and the stored credentials are deleted. The feed keeps serving what it already has; nothing new is added until a CRM is reconnected or a feed is published by hand.",
  });
}
