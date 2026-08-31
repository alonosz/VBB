import type { CrmConnection, CrmConnectionStore } from "@/lib/sync/connections";
import type { OAuthConfig } from "./oauth";
import { needsRefresh, refreshAccessToken, refreshedTokenSet } from "./oauth";

/**
 * A usable Google access token, renewed and stored when it is about to lapse.
 *
 * The same job as the HubSpot version and deliberately not shared with it,
 * because the one dangerous line differs. HubSpot rotates the refresh token on
 * every use and expects the new one saved; Google returns none and expects the
 * old one kept. A single function trying to be both would need a flag, and a
 * flag set wrongly here produces a connection that works for exactly one hour
 * and then dies at 4am with nothing to renew it.
 *
 * `refreshedTokenSet` is that rule, and it is applied here so no caller can
 * forget it.
 */

export const RECONNECT =
  "Google would not renew the connection. Reconnect the Google Ads account.";

export type TokenResult = { token: string; error: null } | { token: null; error: string };

export async function freshAccessToken(opts: {
  connections: Pick<CrmConnectionStore, "save">;
  connection: CrmConnection;
  oauth: OAuthConfig | null;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<TokenResult> {
  const { connections, connection, oauth } = opts;
  const now = opts.now ?? new Date();

  if (!oauth || !needsRefresh(connection.expiresAt, now) || !connection.refreshToken) {
    return { token: connection.accessToken, error: null };
  }

  const fresh = await refreshAccessToken(
    oauth,
    connection.refreshToken,
    opts.fetchImpl ?? fetch,
    now
  );
  if (!fresh) return { token: null, error: RECONNECT };

  // Never lose a working refresh token to Google's silence.
  const stored = refreshedTokenSet(fresh, connection.refreshToken);

  await connections.save({
    workspaceId: connection.workspaceId,
    provider: "google_ads",
    externalAccountId: connection.externalAccountId,
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    expiresAt: stored.expiresAt,
    scopes: connection.scopes,
  });

  return { token: stored.accessToken, error: null };
}
