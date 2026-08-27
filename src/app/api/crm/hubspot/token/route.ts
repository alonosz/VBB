import { NextResponse } from "next/server";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { hashToken, tokenFromInput } from "@/lib/feed/token";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace, feedInWorkspace } from "@/lib/workspace/authorize";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { keyFromEnv } from "@/lib/sync/secrets";
import { HubSpotClient, verifyAccess } from "@/lib/sync/hubspot/client";

/**
 * Connecting one portal with a private app token.
 *
 * OAuth exists for connecting other people's portals. For an advertiser
 * connecting their own, it is a developer account, an app, a redirect URL and
 * a review cycle to achieve what a pasted token does immediately — so this
 * path exists, and the sync treats the result identically. A private token has
 * no refresh and no expiry, so the run simply never renews it.
 *
 * The token is checked against HubSpot before it is stored. A private app with
 * a scope left unticked would otherwise fail at six in the morning with nobody
 * watching; this turns that into an error the advertiser sees while the scopes
 * screen is still open.
 *
 * Authorised by the workspace key. This route used to resolve the feed by its
 * own token, which meant anyone holding a feed URL — a link that lives in a
 * Google Ads configuration screen — could attach their own HubSpot portal to
 * someone else's feed and push a stranger's leads into their account.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const repo = feedRepositoryFromEnv();
  const client = supabaseFromEnv();
  const key = keyFromEnv();
  const workspaces = workspaceRepositoryFromEnv();

  if (!repo || !client || !key || !workspaces) {
    return NextResponse.json(
      { ok: false, error: "Connecting a CRM is not set up on this deployment yet." },
      { status: 503 }
    );
  }

  let body: { url?: unknown; token?: unknown; workspaceKey?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; token?: unknown; workspaceKey?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const auth = await authorizeWorkspace(workspaces, body.workspaceKey);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const feedToken = tokenFromInput(typeof body.url === "string" ? body.url : "");
  if (!feedToken) {
    return NextResponse.json(
      { ok: false, error: "Paste your feed URL so we know which feed to connect." },
      { status: 400 }
    );
  }

  const accessToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Paste the private app token." }, { status: 400 });
  }

  const found = await repo.findByTokenHash(await hashToken(feedToken));
  if (!found || found.status !== "active") {
    return NextResponse.json({ ok: false, error: "No feed found for that URL." }, { status: 404 });
  }

  // The key alone is not enough: it has to be the key for the workspace that
  // owns this feed.
  const owned = await feedInWorkspace(repo, found.id, auth.workspace);
  if (!owned.ok) {
    return NextResponse.json({ ok: false, error: owned.error }, { status: owned.status });
  }
  const feed = owned.feed;

  const verified = await verifyAccess(new HubSpotClient({ accessToken }));
  if (!verified.ok) {
    // Nothing stored. A token that cannot read is not a connection.
    return NextResponse.json({ ok: false, error: verified.error }, { status: 400 });
  }

  try {
    await new CrmConnectionStore(client, key).save({
      feedId: feed.id,
      provider: "hubspot",
      accessToken,
      // Neither applies to a private app token, and saying so beats storing a
      // zero that a later run would read as "expired".
      refreshToken: null,
      expiresAt: null,
      scopes: "private-app",
    });
  } catch (error) {
    console.error("storing a private app token failed:", error);
    return NextResponse.json(
      { ok: false, error: "The connection could not be saved. Nothing was stored." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
