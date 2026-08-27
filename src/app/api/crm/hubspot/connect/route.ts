import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { hashToken, tokenFromInput } from "@/lib/feed/token";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { keyFromEnv } from "@/lib/sync/secrets";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace, feedInWorkspace } from "@/lib/workspace/authorize";
import { authorizeUrl, oauthConfigFromEnv, signState } from "@/lib/sync/hubspot/oauth";

/**
 * Starting a HubSpot connection.
 *
 * POST rather than GET, and the browser does the redirect with what comes
 * back. A GET would put the feed token in a URL, where it would reach the
 * server log, the browser history and the referrer header on the way out to
 * HubSpot — and that token is the whole credential for the feed.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const oauth = oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`);
  const key = keyFromEnv();
  const repo = feedRepositoryFromEnv();
  const workspaces = workspaceRepositoryFromEnv();

  if (!repo || !oauth || !key || !workspaces) {
    return NextResponse.json(
      {
        ok: false,
        error: "Connecting a CRM is not set up on this deployment yet.",
      },
      { status: 503 }
    );
  }

  let body: { url?: unknown; workspaceKey?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; workspaceKey?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const auth = await authorizeWorkspace(workspaces, body.workspaceKey);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const token = tokenFromInput(typeof body.url === "string" ? body.url : "");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Paste your feed URL so we know which feed to connect." },
      { status: 400 }
    );
  }

  const found = await repo.findByTokenHash(await hashToken(token));
  if (!found || found.status !== "active") {
    return NextResponse.json({ ok: false, error: "No feed found for that URL." }, { status: 404 });
  }

  const owned = await feedInWorkspace(repo, found.id, auth.workspace);
  if (!owned.ok) {
    return NextResponse.json({ ok: false, error: owned.error }, { status: owned.status });
  }
  const feed = owned.feed;

  // The feed id travels through HubSpot, signed. The feed *token* does not
  // travel at all.
  return NextResponse.json({
    ok: true,
    authorizeUrl: authorizeUrl(oauth, signState(feed.id, key)),
  });
}
