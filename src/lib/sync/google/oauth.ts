import { postTokenForm, type OAuthConfig, type TokenSet } from "../oauth/tokens";

/**
 * Connecting a Google Ads account.
 *
 * The signed state and the token exchange are shared with every other
 * provider; only what is Google's own lives here.
 */

export { signState, verifyState, STATE_TTL_MS } from "../oauth/state";
export { needsRefresh, type OAuthConfig, type TokenSet } from "../oauth/tokens";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

/**
 * One scope, and it is not read-only.
 *
 * There is no read-only variant of the Ads API scope, so asking for less is
 * not on offer. What we do with it is narrow and worth saying on the consent
 * screen: create one conversion action, upload conversions to it, and read
 * campaign settings. Nothing touches budgets, bids, creatives or targeting.
 */
export const SCOPES = ["https://www.googleapis.com/auth/adwords"];

export function oauthConfigFromEnv(redirectUri: string): OAuthConfig | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) return null;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri };
}

/**
 * Where we send them to approve it.
 *
 * `access_type=offline` and `prompt=consent` are not optional and not
 * decoration. Without the first, Google returns an access token good for an
 * hour and no refresh token at all, so the connection dies overnight and the
 * nightly upload fails with an expired credential nobody can renew. Without
 * the second, Google skips the consent screen for anyone who has approved this
 * app before and *also* omits the refresh token, which means the failure only
 * shows up on the second customer, or on a reconnect, long after the first one
 * worked perfectly.
 */
export function authorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeCode(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date()
): Promise<TokenSet | null> {
  return postTokenForm(
    TOKEN,
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    },
    fetchImpl,
    now
  );
}

/**
 * Renewing the hour-long access token.
 *
 * Google does not hand back a refresh token here, and that is the opposite of
 * HubSpot, which rotates one on every refresh and expects the new one to be
 * saved. Treat Google's silence as rotation and you overwrite a working
 * refresh token with null; treat HubSpot's new one as noise and you keep a
 * dead one. Both mistakes look identical from outside: the connection works
 * for an hour and then stops.
 *
 * So the caller keeps the refresh token it already had unless a non-null one
 * comes back. `refreshedTokenSet` below is that rule, written once.
 */
export function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date()
): Promise<TokenSet | null> {
  return postTokenForm(
    TOKEN,
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    },
    fetchImpl,
    now
  );
}

/** The refreshed set to store: never lose a working refresh token. */
export function refreshedTokenSet(fresh: TokenSet, existing: string): TokenSet {
  return { ...fresh, refreshToken: fresh.refreshToken ?? existing };
}
