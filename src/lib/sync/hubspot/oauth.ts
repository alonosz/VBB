import {
  postTokenForm,
  type OAuthConfig,
  type TokenSet,
} from "../oauth/tokens";

/**
 * Connecting a HubSpot portal.
 *
 * Only what is HubSpot's own lives here: its two endpoints, its scope list,
 * and the shape of its authorize URL. The signed state and the token exchange
 * are the same job for every provider and live in `../oauth`.
 */

export { signState, verifyState, STATE_TTL_MS } from "../oauth/state";
export { needsRefresh, type OAuthConfig, type TokenSet } from "../oauth/tokens";

const AUTHORIZE = "https://app.hubspot.com/oauth/authorize";
const TOKEN = "https://api.hubapi.com/oauth/v1/token";

/**
 * Read-only, and only the objects the model is fitted on.
 *
 * Deals for the outcome and amount, contacts for the email and click ID,
 * companies for size and industry. Nothing that would let this write to a
 * customer's CRM, because it never needs to.
 *
 * These must stay identical to `requiredScopes` in the app's
 * `app-hsmeta.json` (see HUBSPOT_APP.md). HubSpot refuses an install whose
 * authorize URL omits a scope the app declares as required, or requests one
 * the app does not declare - in both directions, and with an error about a
 * "mismatch" rather than about which scope. That is why `oauth` is in this
 * list: it grants nothing on its own, it is the handshake itself, and the
 * generated app config declares it.
 */
export const SCOPES = [
  "oauth",
  "crm.objects.deals.read",
  "crm.objects.contacts.read",
  "crm.objects.companies.read",
];

/** The scopes that actually reach data. Everything here is read-only. */
export const DATA_SCOPES = SCOPES.filter((s) => s !== "oauth");

export function oauthConfigFromEnv(redirectUri: string): OAuthConfig | null {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) return null;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri };
}

// ---------------------------------------------------------------------------
// The exchange
// ---------------------------------------------------------------------------

export function authorizeUrl(config: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", SCOPES.join(" "));
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
