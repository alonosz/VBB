import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { keyFromEnv } from "@/lib/sync/secrets";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { exchangeCode, oauthConfigFromEnv, SCOPES, verifyState } from "@/lib/sync/hubspot/oauth";

/**
 * Coming back from HubSpot.
 *
 * Everything in this request arrived through a redirect the user's browser
 * followed, so none of it is trusted on its face. The state's signature is
 * what ties this callback to the feed that started it — without accounts,
 * nothing else could.
 *
 * Ends in a redirect to a page rather than JSON, because a person is looking
 * at this in a browser tab.
 */

export const runtime = "nodejs";

function back(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL(`${origin}/crm/connected`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = feedOriginFromEnv(requestUrl.origin);

  const oauth = oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`);
  const key = keyFromEnv();
  const repo = feedRepositoryFromEnv();
  const client = supabaseFromEnv();

  if (!repo || !oauth || !key || !client) {
    return back(origin, { status: "error", reason: "Connecting a CRM is not set up on this deployment." });
  }

  // HubSpot sends the user back here with an error when they decline.
  const denied = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  if (denied) {
    return back(origin, { status: "error", reason: "HubSpot did not complete the connection." });
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) {
    return back(origin, { status: "error", reason: "That link is incomplete. Start the connection again." });
  }

  const feedId = verifyState(state, key);
  if (!feedId) {
    return back(origin, {
      status: "error",
      reason: "That connection link has expired or was altered. Start it again from your feed.",
    });
  }

  const feed = await repo.findById(feedId);
  if (!feed || feed.status !== "active") {
    return back(origin, { status: "error", reason: "That feed no longer exists." });
  }

  const tokens = await exchangeCode(oauth, code, fetch);
  if (!tokens) {
    return back(origin, { status: "error", reason: "HubSpot would not complete the connection. Try again." });
  }

  try {
    await new CrmConnectionStore(client, key).save({
      feedId,
      provider: "hubspot",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: SCOPES.join(" "),
    });
  } catch (error) {
    console.error("storing a CRM connection failed:", error);
    return back(origin, { status: "error", reason: "The connection could not be saved. Nothing was stored." });
  }

  return back(origin, { status: "connected" });
}
