import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { keyFromEnv } from "@/lib/sync/secrets";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { exchangeCode, oauthConfigFromEnv, SCOPES, verifyState } from "@/lib/sync/google/oauth";

/**
 * Coming back from Google.
 *
 * Everything in this request arrived through a redirect the browser followed,
 * so none of it is trusted on its face. The state's signature is what ties
 * this callback to the workspace that started it; with no user accounts,
 * nothing else could.
 *
 * Ends in a redirect rather than JSON, because a person is looking at a
 * browser tab. They land back on the step they left, which is where the next
 * thing to do is.
 */

export const runtime = "nodejs";

function back(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL(`${origin}/diagnostic/connect`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

const failed = (origin: string, reason: string) =>
  back(origin, { google: "error", reason });

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = feedOriginFromEnv(requestUrl.origin);

  const oauth = oauthConfigFromEnv(`${origin}/api/ads/google/callback`);
  const key = keyFromEnv();
  const workspaces = workspaceRepositoryFromEnv();
  const client = supabaseFromEnv();

  if (!oauth || !key || !workspaces || !client) {
    return failed(origin, "Connecting Google Ads is not set up on this deployment.");
  }

  // Google sends them back here with an error when they decline.
  if (requestUrl.searchParams.get("error")) {
    return failed(origin, "Google did not complete the connection.");
  }

  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  if (!code || !state) {
    return failed(origin, "That link is incomplete. Start the connection again.");
  }

  const workspaceId = verifyState(state, key);
  if (!workspaceId) {
    return failed(origin, "That connection link has expired or was altered. Start it again.");
  }

  const workspace = await workspaces.findById(workspaceId);
  if (!workspace || workspace.status !== "active") {
    return failed(origin, "That workspace is no longer active.");
  }

  const tokens = await exchangeCode(oauth, code, fetch);
  if (!tokens) {
    return failed(origin, "Google would not complete the connection. Try again.");
  }

  /*
   * No refresh token means this connection is good for one hour and then dead,
   * with a nightly upload that fails at 4am with a credential nobody can
   * renew. Better to refuse it now and say so: it is the symptom of an
   * authorize URL missing access_type=offline or prompt=consent, and of
   * nothing else.
   */
  if (!tokens.refreshToken) {
    console.error("Google returned no refresh token - check access_type and prompt on the authorize URL");
    return failed(
      origin,
      "Google did not grant lasting access, so the connection would stop working within the hour. Try again."
    );
  }

  try {
    await new CrmConnectionStore(client, key).save({
      workspaceId,
      provider: "google_ads",
      // Which account, once they have picked one. OAuth says who they are,
      // not which of their accounts this feed prices.
      externalAccountId: null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: SCOPES.join(" "),
    });
  } catch (error) {
    console.error("storing a Google Ads connection failed:", error);
    return failed(origin, "The connection could not be saved. Nothing was stored.");
  }

  return back(origin, { google: "connected" });
}
