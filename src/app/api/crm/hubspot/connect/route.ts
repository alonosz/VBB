import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { keyFromEnv } from "@/lib/sync/secrets";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";
import { authorizeUrl, oauthConfigFromEnv, signState } from "@/lib/sync/hubspot/oauth";

/**
 * Starting a HubSpot connection.
 *
 * POST rather than GET, and the browser does the redirect with what comes
 * back. A GET would put the feed token in a URL, where it would reach the
 * server log, the browser history and the referrer header on the way out to
 * HubSpot - and that token is the whole credential for the feed.
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

  // No feed URL any more. A connection belongs to the customer, and the
  // workspace key already says which customer this is - which is what lets
  // HubSpot be connected at step 2, before any feed exists.
  //
  // The workspace id travels through HubSpot, signed. No credential travels.
  return NextResponse.json({
    ok: true,
    authorizeUrl: authorizeUrl(oauth, signState(auth.workspace.id, key)),
  });
}
