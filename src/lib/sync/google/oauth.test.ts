import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  refreshedTokenSet,
  signState,
  verifyState,
  needsRefresh,
  SCOPES,
  STATE_TTL_MS,
} from "./oauth";

const CONFIG = {
  clientId: "1234.apps.googleusercontent.com",
  clientSecret: "secret",
  redirectUri: "https://vbb.example/api/ads/google/callback",
};
const KEY = Buffer.from("a".repeat(64), "hex");
const NOW = new Date("2026-08-30T12:00:00Z");

function jsonOnce(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 400 })) as unknown as typeof fetch;
}

describe("the authorize URL", () => {
  const url = new URL(authorizeUrl(CONFIG, "state-abc"));

  /*
   * The two parameters that decide whether this product works tomorrow.
   *
   * Without access_type=offline Google returns an access token good for an
   * hour and no refresh token, so the nightly upload fails with a credential
   * nobody can renew. Without prompt=consent it skips the consent screen for
   * anyone who has approved the app before and omits the refresh token again -
   * which means the bug hides until the second customer, or a reconnect.
   */
  it("asks for offline access, so a refresh token comes back", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("forces the consent screen, so a reconnect also returns one", () => {
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("carries the signed state and the redirect Google will check", () => {
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("asks for the ads scope and nothing else", () => {
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(" "));
    expect(SCOPES).toHaveLength(1);
  });
});

describe("the state parameter", () => {
  it("round-trips the workspace it was signed for", () => {
    const state = signState("ws-1", KEY, NOW);
    expect(verifyState(state, KEY, NOW)).toBe("ws-1");
  });

  /*
   * The whole reason it is signed. Nothing about the browser coming back from
   * Google proves it is the one that left, so an edited state is the way
   * somebody would attach their own ads account to another advertiser's
   * workspace.
   */
  it("refuses a state signed with a different key", () => {
    const state = signState("ws-1", KEY, NOW);
    expect(verifyState(state, Buffer.from("b".repeat(64), "hex"), NOW)).toBeNull();
  });

  it("refuses one that has gone stale", () => {
    const state = signState("ws-1", KEY, NOW);
    const late = new Date(NOW.getTime() + STATE_TTL_MS + 1000);
    expect(verifyState(state, KEY, late)).toBeNull();
  });
});

describe("the token exchange", () => {
  it("reads the token set out of Google's reply", async () => {
    const set = await exchangeCode(
      CONFIG,
      "code-1",
      jsonOnce({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      NOW
    );
    expect(set?.accessToken).toBe("at");
    expect(set?.refreshToken).toBe("rt");
    // A minute of headroom, so it cannot expire between the check and the call.
    expect(set?.expiresAt).toEqual(new Date(NOW.getTime() + 3540 * 1000));
    expect(needsRefresh(set!.expiresAt, NOW)).toBe(false);
  });

  it("returns nothing rather than a half token when Google refuses", async () => {
    expect(await exchangeCode(CONFIG, "bad", jsonOnce({ error: "invalid_grant" }, false), NOW))
      .toBeNull();
  });
});

describe("refreshing", () => {
  /*
   * Google does not return a refresh token here and HubSpot does. Treat
   * Google's silence as rotation and a working refresh token is overwritten
   * with null; the connection then works for exactly one hour and dies, which
   * is a failure nobody debugs on the day they cause it.
   */
  it("keeps the refresh token we already had when Google sends none", async () => {
    const fresh = await refreshAccessToken(
      CONFIG,
      "rt-original",
      jsonOnce({ access_token: "at-2", expires_in: 3600 }),
      NOW
    );
    expect(fresh?.refreshToken).toBeNull();
    expect(refreshedTokenSet(fresh!, "rt-original").refreshToken).toBe("rt-original");
  });

  it("takes a new refresh token when one is actually sent", async () => {
    const fresh = await refreshAccessToken(
      CONFIG,
      "rt-original",
      jsonOnce({ access_token: "at-2", refresh_token: "rt-new", expires_in: 3600 }),
      NOW
    );
    expect(refreshedTokenSet(fresh!, "rt-original").refreshToken).toBe("rt-new");
  });

  it("knows when a token has run out", () => {
    expect(needsRefresh(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(needsRefresh(new Date(NOW.getTime() + 60_000), NOW)).toBe(false);
    // No expiry given is not the same as expired.
    expect(needsRefresh(null, NOW)).toBe(false);
  });
});
