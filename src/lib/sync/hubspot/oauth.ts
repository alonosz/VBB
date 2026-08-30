import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Connecting a HubSpot portal to a feed.
 *
 * There are no user accounts in this product, so nothing about the browser
 * that returns from HubSpot proves it is the same one that left. The feed
 * token is the only credential in play, and it must not travel through
 * HubSpot's redirect where it would land in logs and browser history.
 *
 * So the state parameter carries the feed *id* and a timestamp, signed with a
 * key only this server holds. The callback trusts the signature rather than
 * the browser: an unsigned, edited or stale state is refused, which is what
 * stops someone attaching their own portal to another advertiser's feed.
 */

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

/** A connect link is for finishing now, not for keeping. */
export const STATE_TTL_MS = 15 * 60 * 1000;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function oauthConfigFromEnv(redirectUri: string): OAuthConfig | null {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) return null;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signState(feedId: string, key: Buffer, now: Date = new Date()): string {
  const payload = `${feedId}.${now.getTime()}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload, key)}`;
}

/** Returns the feed id, or null for anything unsigned, edited or expired. */
export function verifyState(state: string, key: Buffer, now: Date = new Date()): string | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;

  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(parts[1]);
  // Constant-time, so the comparison cannot be used to discover a valid
  // signature one byte at a time.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const split = payload.lastIndexOf(".");
  if (split <= 0) return null;
  const feedId = payload.slice(0, split);
  const issued = Number(payload.slice(split + 1));
  if (!Number.isFinite(issued)) return null;
  if (now.getTime() - issued > STATE_TTL_MS) return null;
  if (issued - now.getTime() > 60_000) return null; // clock skew, not the future

  return feedId || null;
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

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function postForm(
  url: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
  now: Date
): Promise<TokenSet | null> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });

  if (!res.ok) return null;

  const body = (await res.json()) as TokenResponse;
  if (!body.access_token) return null;

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: body.expires_in
      // A minute of headroom, so a token does not expire between the check and
      // the call that uses it.
      ? new Date(now.getTime() + (body.expires_in - 60) * 1000)
      : null,
  };
}

export function exchangeCode(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date()
): Promise<TokenSet | null> {
  return postForm(
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
  return postForm(
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

/** With a minute of headroom already built into expiresAt. */
export function needsRefresh(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}
