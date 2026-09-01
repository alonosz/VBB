import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";
import { keyFromEnv } from "@/lib/sync/secrets";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { AdsClient, credentialsFromEnv } from "./client";
import { missingScopes, oauthConfigFromEnv } from "./oauth";
import { freshAccessToken } from "./accessToken";

/**
 * Everything a Google Ads route needs, or the reason it cannot have it.
 *
 * Both routes need the same six things resolved in the same order - settings,
 * workspace, stored connection, a token that has not lapsed, a developer
 * token, a client - and each step has its own way of failing that the
 * advertiser has to be told about differently. Doing that twice would mean two
 * versions of "reconnect your account" that drift apart.
 */

export type AdsSession =
  | {
      ok: true;
      client: AdsClient;
      /**
       * The bare token, because the Data Manager API is a different host with
       * different headers and no developer token - it cannot ride the Ads
       * client. Same credential, two destinations.
       */
      accessToken: string;
      workspaceId: string;
      connectedAccountId: string | null;
    }
  | { ok: false; status: number; error: string };

export async function adsSession(request: Request, workspaceKey: unknown): Promise<AdsSession> {
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const oauth = oauthConfigFromEnv(`${origin}/api/ads/google/callback`);
  const key = keyFromEnv();
  const workspaces = workspaceRepositoryFromEnv();
  const supabase = supabaseFromEnv();

  if (!oauth || !key || !workspaces || !supabase) {
    const missing = Object.entries({
      "workspace store": workspaces,
      Supabase: supabase,
      "GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET": oauth,
      "VBB_TOKEN_KEY (64 hex, base64 of 32 bytes, or 24+ characters)": key,
    })
      .filter(([, v]) => !v)
      .map(([name]) => name);
    console.error(`Google Ads is not configured: ${missing.join(", ")}`);
    return {
      ok: false,
      status: 503,
      error:
        "Google Ads is not set up on this deployment yet. Whoever deployed it can " +
        "see which setting is missing in the server log.",
    };
  }

  const auth = await authorizeWorkspace(
    workspaces,
    typeof workspaceKey === "string" ? workspaceKey : ""
  );
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };

  const connections = new CrmConnectionStore(supabase, key);
  const loaded = await connections.load(auth.workspace.id, "google_ads");
  if (!loaded.connection) {
    // 409 rather than 401: the caller is who they say they are, they simply
    // have not connected Google yet. The browser starts the handshake on this.
    return { ok: false, status: 409, error: loaded.error ?? "No Google Ads account connected." };
  }

  /*
   * A connection authorised before we needed a scope carries a token that
   * cannot use it, and Google answers "insufficient authentication scopes"
   * from deep inside a send rather than at the door. Worse, the connect
   * button could not fix it: it lists accounts whenever a connection exists,
   * so it never re-asked and the customer had no way forward.
   *
   * Refusing here with a 409 puts it back on the path that already works -
   * the browser starts the handshake on a 409, exactly as it does for a
   * workspace that has never connected at all.
   */
  if (missingScopes(loaded.connection.scopes).length > 0) {
    return {
      ok: false,
      status: 409,
      error:
        "This Google connection was authorised before we needed one of the " +
        "permissions it now uses. Reconnecting grants it - nothing else changes.",
    };
  }

  const fresh = await freshAccessToken({
    connections,
    connection: loaded.connection,
    oauth,
  });
  if (fresh.token === null) return { ok: false, status: 401, error: fresh.error };

  /*
   * The developer token is ours, not the customer's, and it is the one thing
   * here that is missing for a reason nobody in the browser can fix. Saying
   * "reconnect your account" would send them round a loop that cannot help.
   */
  const credentials = credentialsFromEnv(fresh.token);
  if (!credentials) {
    console.error("GOOGLE_ADS_DEVELOPER_TOKEN is not set");
    return {
      ok: false,
      status: 503,
      error:
        "Google Ads access is still being approved on our side. Your connection is " +
        "fine - nothing for you to do.",
    };
  }

  return {
    ok: true,
    client: new AdsClient({ credentials }),
    accessToken: fresh.token,
    workspaceId: auth.workspace.id,
    connectedAccountId: loaded.connection.externalAccountId,
  };
}

/** The same JSON shape every Google Ads route refuses with. */
export function refuse(session: Extract<AdsSession, { ok: false }>) {
  return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
}
