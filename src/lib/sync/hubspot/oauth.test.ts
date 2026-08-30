import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  exchangeCode,
  needsRefresh,
  refreshAccessToken,
  signState,
  DATA_SCOPES,
  SCOPES,
  STATE_TTL_MS,
  verifyState,
  type OAuthConfig,
} from "./oauth";
import { generateKey, parseKey } from "../secrets";

const KEY = parseKey(generateKey())!;
const NOW = new Date("2026-06-15T12:00:00Z");
const FEED = "0d5f1a2b-3c4d-5e6f-7081-92a3b4c5d6e7";

const CONFIG: OAuthConfig = {
  clientId: "client-123",
  clientSecret: "shhh",
  redirectUri: "https://vbb-cyan.vercel.app/api/crm/hubspot/callback",
};

describe("state", () => {
  it("round-trips the feed id", () => {
    expect(verifyState(signState(FEED, KEY, NOW), KEY, NOW)).toBe(FEED);
  });

  it("refuses a state signed with another key", () => {
    const other = parseKey(generateKey())!;
    // The signature is what stops someone attaching their portal to another
    // advertiser's feed, so this is the assertion that matters most here.
    expect(verifyState(signState(FEED, other, NOW), KEY, NOW)).toBeNull();
  });

  it("refuses a state whose feed id was edited", () => {
    const state = signState(FEED, KEY, NOW);
    const [payload, signature] = state.split(".");
    const decoded = Buffer.from(payload, "base64url").toString();
    const tampered = Buffer.from(decoded.replace(FEED, "someone-elses-feed")).toString("base64url");
    expect(verifyState(`${tampered}.${signature}`, KEY, NOW)).toBeNull();
  });

  it("expires, so a connect link is not a permanent grant", () => {
    const state = signState(FEED, KEY, NOW);
    const later = new Date(NOW.getTime() + STATE_TTL_MS + 1000);
    expect(verifyState(state, KEY, later)).toBeNull();
    // Still good just inside the window.
    expect(verifyState(state, KEY, new Date(NOW.getTime() + STATE_TTL_MS - 1000))).toBe(FEED);
  });

  it("refuses a state issued in the future beyond clock skew", () => {
    const ahead = new Date(NOW.getTime() + 10 * 60_000);
    expect(verifyState(signState(FEED, KEY, ahead), KEY, NOW)).toBeNull();
  });

  it("refuses junk rather than throwing", () => {
    for (const junk of ["", ".", "a.b.c", "notbase64.sig", "onlyonepart"]) {
      expect(verifyState(junk, KEY, NOW), junk).toBeNull();
    }
  });
});

describe("authorizeUrl", () => {
  it("asks only for read scopes", () => {
    const url = new URL(authorizeUrl(CONFIG, "state-x"));
    expect(url.origin + url.pathname).toBe("https://app.hubspot.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(" "));
    // Nothing that reaches data should let the sync modify a customer's CRM.
    for (const scope of DATA_SCOPES) expect(scope).toMatch(/\.read$/);
    expect(SCOPES).not.toContain("crm.objects.contacts.write");
  });

  /*
   * The install fails without this, and the error HubSpot shows says
   * "mismatch" without naming the scope. Required scopes must appear in every
   * authorize URL, so this list has to stay identical to `requiredScopes` in
   * app-hsmeta.json - in both directions, since requesting a scope the app
   * does not declare is refused too.
   */
  it("requests the handshake scope the app config declares as required", () => {
    const url = new URL(authorizeUrl(CONFIG, "state-x"));
    expect(url.searchParams.get("scope")?.split(" ")).toContain("oauth");
  });

  it("requests exactly the four the app declares, and no more", () => {
    expect([...SCOPES].sort()).toEqual([
      "crm.objects.companies.read",
      "crm.objects.contacts.read",
      "crm.objects.deals.read",
      "oauth",
    ]);
  });

  it("never puts the feed token in the redirect", () => {
    const url = authorizeUrl(CONFIG, signState(FEED, KEY, NOW));
    expect(url).not.toContain("vbb_live_");
  });

  it("carries the state and redirect back", () => {
    const url = new URL(authorizeUrl(CONFIG, "state-x"));
    expect(url.searchParams.get("state")).toBe("state-x");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("client_id")).toBe("client-123");
  });
});

function tokenStub(body: unknown, status = 200) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), form: new URLSearchParams(String(init?.body ?? "")) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("exchangeCode", () => {
  it("returns the token set, with headroom on the expiry", async () => {
    const { fetchImpl, calls } = tokenStub({
      access_token: "access-1", refresh_token: "refresh-1", expires_in: 1800,
    });
    const set = await exchangeCode(CONFIG, "code-1", fetchImpl, NOW);

    expect(set).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1" });
    // A minute short of the real expiry, so it cannot lapse between the check
    // and the call that uses it.
    expect(set!.expiresAt!.getTime()).toBe(NOW.getTime() + (1800 - 60) * 1000);
    expect(calls[0].form.get("grant_type")).toBe("authorization_code");
    expect(calls[0].form.get("code")).toBe("code-1");
  });

  it("returns null rather than a half-built connection when HubSpot refuses", async () => {
    const { fetchImpl } = tokenStub({ message: "expired" }, 400);
    expect(await exchangeCode(CONFIG, "code-1", fetchImpl, NOW)).toBeNull();
  });

  it("returns null when the response carries no access token", async () => {
    const { fetchImpl } = tokenStub({ refresh_token: "only-this" });
    expect(await exchangeCode(CONFIG, "code-1", fetchImpl, NOW)).toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("uses the refresh grant", async () => {
    const { fetchImpl, calls } = tokenStub({ access_token: "access-2", expires_in: 1800 });
    const set = await refreshAccessToken(CONFIG, "refresh-1", fetchImpl, NOW);
    expect(set?.accessToken).toBe("access-2");
    expect(calls[0].form.get("grant_type")).toBe("refresh_token");
    expect(calls[0].form.get("refresh_token")).toBe("refresh-1");
  });
});

describe("needsRefresh", () => {
  it("is false when there is no expiry to reason about", () => {
    expect(needsRefresh(null, NOW)).toBe(false);
  });

  it("is true once the headroomed expiry has passed", () => {
    expect(needsRefresh(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(needsRefresh(new Date(NOW.getTime() + 60_000), NOW)).toBe(false);
  });
});
