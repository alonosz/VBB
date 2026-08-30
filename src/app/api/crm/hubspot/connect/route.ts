import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { keyFromEnv } from "@/lib/sync/secrets";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeOrCreateWorkspace } from "@/lib/workspace/selfServe";
import { authorizeUrl, oauthConfigFromEnv, signState } from "@/lib/sync/hubspot/oauth";

/**
 * Starting a HubSpot connection.
 *
 * POST rather than GET, and the browser does the redirect with what comes
 * back. A GET would put the feed token in a URL, where it would reach the
 * server log, the browser history and the referrer header on the way out to
 * HubSpot - and that token is the whole credential for the feed.
 */

/**
 * The caller, for rate limiting a route anyone can reach.
 *
 * First hop only. The rest of an x-forwarded-for chain is written by whoever
 * is calling, so counting against it would let one script present a new
 * "caller" on every request.
 */
function callerIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const oauth = oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`);
  const key = keyFromEnv();
  const repo = feedRepositoryFromEnv();
  const workspaces = workspaceRepositoryFromEnv();

  // Same trap as the deals route: one sentence for the advertiser, the actual
  // missing setting in the log for whoever deployed it. A VBB_TOKEN_KEY under
  // 24 characters is refused rather than padded, and from out here that is
  // indistinguishable from having no database at all.
  // The guard stays a plain boolean so TypeScript keeps narrowing these to
  // non-null past it; the list is only built once we know one is missing.
  if (!repo || !oauth || !key || !workspaces) {
    const missing = Object.entries({
      Supabase: repo,
      "workspace store": workspaces,
      "HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET": oauth,
      "VBB_TOKEN_KEY (64 hex, base64 of 32 bytes, or 24+ characters)": key,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);

    console.error(`Cannot connect a CRM: not configured - ${missing.join(", ")}`);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Connecting a CRM is not set up on this deployment yet. Whoever deployed " +
          "it can see which setting is missing in the server log.",
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

  // No key at all means a new visitor, and they get a workspace rather than
  // an instruction to find a credential they have never heard of. A key that
  // does not work is still an error: minting around a typo would orphan the
  // feed Google is reading.
  const auth = await authorizeOrCreateWorkspace({
    repo: workspaces,
    presented: body.workspaceKey,
    ip: callerIp(request),
  });
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
    // Present only when one was just created. This is the single moment the
    // key exists outside a hash, so the browser has to keep it now or the
    // workspace becomes unreachable.
    ...(auth.mintedKey ? { workspaceKey: auth.mintedKey } : {}),
  });
}
