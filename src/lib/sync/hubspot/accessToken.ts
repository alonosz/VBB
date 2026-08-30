import type { CrmConnection, CrmConnectionStore } from "@/lib/sync/connections";
import type { OAuthConfig } from "./oauth";
import { needsRefresh, refreshAccessToken } from "./oauth";

/**
 * A usable access token, renewed and stored if it was about to expire.
 *
 * This was inline in the nightly sync until a second caller needed it, and a
 * second copy is how the two end up disagreeing. The dangerous half is the
 * storing: HubSpot rotates the refresh token every time one is used, so a
 * caller that refreshes and forgets to save the new one has silently spent the
 * customer's connection. Both callers must do it identically, so neither does
 * it itself.
 *
 * A refusal here is always the same instruction to the advertiser - reconnect
 * - whatever the underlying cause, so the message is fixed rather than
 * assembled from whatever HubSpot said.
 */

export const RECONNECT = "HubSpot would not renew the connection. Reconnect the account.";

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
  const fetchImpl = opts.fetchImpl ?? fetch;

  // A portal connected with a private app token has no refresh token and no
  // expiry, so there is nothing to renew and nothing to store.
  if (!oauth || !needsRefresh(connection.expiresAt, now) || !connection.refreshToken) {
    return { token: connection.accessToken, error: null };
  }

  const refreshed = await refreshAccessToken(oauth, connection.refreshToken, fetchImpl, now);
  if (!refreshed) return { token: null, error: RECONNECT };

  await connections.save({
    workspaceId: connection.workspaceId,
    provider: "hubspot",
    externalAccountId: connection.externalAccountId,
    accessToken: refreshed.accessToken,
    // HubSpot may or may not rotate it. Keeping the old one when it does not
    // is the difference between a connection that survives and one that dies
    // at the next renewal.
    refreshToken: refreshed.refreshToken ?? connection.refreshToken,
    expiresAt: refreshed.expiresAt,
    scopes: connection.scopes,
  });

  return { token: refreshed.accessToken, error: null };
}
