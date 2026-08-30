import { describe, expect, it } from "vitest";
import {
  AdsClient,
  AdsApiError,
  API_VERSION,
  formatCustomerId,
  normalizeCustomerId,
  readError,
} from "./client";
import { fakeAds } from "./fakeAds";

function client(over: Partial<Parameters<typeof fakeAds>[0]> = {}) {
  const ads = fakeAds(over);
  return {
    ads,
    client: new AdsClient({
      credentials: ads.credentials,
      fetchImpl: ads.fetchImpl,
      origin: ads.origin,
    }),
  };
}

describe("customer ids", () => {
  /*
   * Google Ads prints 593-222-7642 on every screen and the API accepts only
   * 5932227642. Pasting what is on the screen is the obvious thing to do and
   * fails with a NOT_FOUND that names nothing at all.
   */
  it("strips the dashes Google's own interface shows", () => {
    expect(normalizeCustomerId("593-222-7642")).toBe("5932227642");
    expect(normalizeCustomerId(" 593 222 7642 ")).toBe("5932227642");
    expect(normalizeCustomerId("5932227642")).toBe("5932227642");
  });

  it("refuses anything that is not ten digits, rather than sending it", () => {
    expect(normalizeCustomerId("59322")).toBeNull();
    expect(normalizeCustomerId("59322276421")).toBeNull();
    expect(normalizeCustomerId("abc-def-ghij")).toBeNull();
    expect(normalizeCustomerId("")).toBeNull();
  });

  it("puts them back the way a person recognises them", () => {
    expect(formatCustomerId("5932227642")).toBe("593-222-7642");
    // Round-trips, so a value shown on screen can be pasted back in.
    expect(normalizeCustomerId(formatCustomerId("5932227642"))).toBe("5932227642");
  });
});

describe("every request", () => {
  it("carries the three headers Google requires", async () => {
    const { ads, client: c } = client({ responses: { "customers/5932227642:search": { results: [] } } });
    await c.post("customers/5932227642:search", { query: "SELECT customer.id FROM customer" });

    const call = ads.calls[0];
    expect(call.headers.authorization).toBe("Bearer access-token-test");
    expect(call.headers["developer-token"]).toBe("dev-token-test");
    expect(call.headers["content-type"]).toBe("application/json");
  });

  /*
   * An empty login-customer-id is not the same as an absent one and Google
   * rejects the empty version. A self-serve advertiser authorises us directly
   * against their own account, so there is usually no manager in the picture.
   */
  it("omits login-customer-id entirely when there is no manager account", async () => {
    const { ads, client: c } = client();
    await c.post("customers/5932227642:search", {});
    expect("login-customer-id" in ads.calls[0].headers).toBe(false);
  });

  it("sends login-customer-id when acting through a manager", async () => {
    const ads = fakeAds();
    const c = new AdsClient({
      credentials: { ...ads.credentials, loginCustomerId: "1234567890" },
      fetchImpl: ads.fetchImpl,
      origin: ads.origin,
    });
    await c.post("customers/5932227642:search", {});
    expect(ads.calls[0].headers["login-customer-id"]).toBe("1234567890");
  });

  it("calls the pinned API version", async () => {
    const { ads, client: c } = client();
    await c.post("customers/5932227642:search", {});
    expect(API_VERSION).toMatch(/^v\d+$/);
    // The fake splits on the version, so a mismatch would leave the full URL.
    expect(ads.calls[0].path).toBe("customers/5932227642:search");
  });
});

describe("when Google refuses", () => {
  /*
   * The reason this route exists. A refused CSV fetch and a dead URL are the
   * same event from the feed's side; here the specific reason comes back and
   * can be told to the advertiser.
   */
  it("digs out the specific error, not the generic one at the top", async () => {
    const { client: c } = client({
      failures: {
        "customers/5932227642:uploadClickConversions": {
          status: 400,
          errorCode: "CONVERSION_ACTION_NOT_FOUND",
          message: 'No conversion action named "VBB Lead Value" exists in this account.',
        },
      },
    });

    await expect(c.post("customers/5932227642:uploadClickConversions", {})).rejects.toThrow(
      /No conversion action named/
    );

    const err = (await c
      .post("customers/5932227642:uploadClickConversions", {})
      .catch((e) => e)) as AdsApiError;
    expect(err).toBeInstanceOf(AdsApiError);
    expect(err.errorCode).toBe("CONVERSION_ACTION_NOT_FOUND");
    expect(err.status).toBe(400);
    // Kept so a support conversation with Google can name the exact call.
    expect(err.requestId).toBe("req-2");
    // The generic wrapper is not what a person is shown.
    expect(err.message).not.toMatch(/invalid argument/i);
  });

  it("names an unapproved developer token, which is its own kind of stuck", async () => {
    const ads = fakeAds({ developerToken: "the-real-one" });
    const c = new AdsClient({
      credentials: { ...ads.credentials, developerToken: "not-approved-yet" },
      fetchImpl: ads.fetchImpl,
      origin: ads.origin,
    });
    const err = (await c.post("customers/1:search", {}).catch((e) => e)) as AdsApiError;
    expect(err.errorCode).toBe("DEVELOPER_TOKEN_NOT_APPROVED");
    expect(err.message).toMatch(/developer token is not approved/i);
  });

  it("separates a credential problem from a bad request", async () => {
    expect(readError(401, {}).needsReconnect).toBe(true);
    expect(
      readError(403, {
        error: { details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] },
      }).needsReconnect
    ).toBe(true);
    // A malformed row is our bug to fix, not something to make them reconnect.
    expect(readError(400, {}).needsReconnect).toBe(false);
  });

  /*
   * Unreachable is not refused. Telling an advertiser to reconnect a
   * connection that is perfectly fine sends them to fix the wrong thing.
   */
  it("treats an unreachable Google as a network problem, not a bad credential", async () => {
    const c = new AdsClient({
      credentials: { accessToken: "a", developerToken: "b" },
      fetchImpl: (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch,
    });
    const err = (await c.post("customers/1:search", {}).catch((e) => e)) as AdsApiError;
    expect(err.errorCode).toBe("UNREACHABLE");
    expect(err.needsReconnect).toBe(false);
    expect(err.message).toMatch(/couldn't reach Google Ads/);
  });

  it("survives a refusal that is not JSON at all", () => {
    const err = readError(502, null);
    expect(err.message).toMatch(/HTTP 502/);
    expect(err.errorCode).toBeNull();
  });
});
