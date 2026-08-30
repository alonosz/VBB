/**
 * The OAuth token exchange, shared by every provider.
 *
 * Both halves of the dance are the same everywhere: post a form, read a JSON
 * body, and never let a token outlive the moment it stops working.
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
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

/**
 * A minute of headroom is subtracted from every expiry, so a token cannot
 * expire in the gap between the check that said it was fine and the call that
 * used it.
 */
export const EXPIRY_HEADROOM_MS = 60_000;

export async function postTokenForm(
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
      ? new Date(now.getTime() + body.expires_in * 1000 - EXPIRY_HEADROOM_MS)
      : null,
  };
}

/** With the headroom already built into expiresAt. */
export function needsRefresh(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}
