import { describe, expect, it } from "vitest";
import { AdsClient } from "./client";
import { fakeAds, type FakeAdsOptions } from "./fakeAds";
import {
  checkAccount,
  describeAccount,
  listAccessibleCustomerIds,
  listAccounts,
  usableAccounts,
  type AdsAccount,
} from "./accounts";

function customer(over: Record<string, unknown> = {}) {
  return {
    results: [
      {
        customer: {
          id: "5932227642",
          descriptiveName: "Northridge Fabrication",
          currencyCode: "USD",
          timeZone: "America/New_York",
          manager: false,
          status: "ENABLED",
          ...over,
        },
      },
    ],
  };
}

function withAccounts(
  ids: string[],
  bodies: Record<string, unknown> = {},
  failures: FakeAdsOptions["failures"] = {}
) {
  const ads = fakeAds({
    responses: {
      "customers:listAccessibleCustomers": { resourceNames: ids.map((id) => `customers/${id}`) },
      ...bodies,
    },
    failures,
  });
  return new AdsClient({
    credentials: ads.credentials,
    fetchImpl: ads.fetchImpl,
    origin: ads.origin,
  });
}

const account = (over: Partial<AdsAccount> = {}): AdsAccount => ({
  customerId: "5932227642",
  displayId: "593-222-7642",
  name: "Northridge Fabrication",
  currencyCode: "USD",
  timeZone: "America/New_York",
  isManager: false,
  status: "ENABLED",
  ...over,
});

describe("listing what a login can reach", () => {
  it("reads the ids out of Google's resource names", async () => {
    const c = withAccounts(["5932227642", "1234567890"]);
    expect(await listAccessibleCustomerIds(c)).toEqual(["5932227642", "1234567890"]);
  });

  /*
   * A malformed id becomes a request against nothing, and Google's answer to
   * that names neither the id nor the problem. Dropping it here keeps the rest
   * of the list working.
   */
  it("drops a resource name that is not a ten digit id", async () => {
    const c = withAccounts(["5932227642", "not-an-id", ""]);
    expect(await listAccessibleCustomerIds(c)).toEqual(["5932227642"]);
  });

  it("returns nothing rather than throwing when the login reaches no accounts", async () => {
    const ads = fakeAds({ responses: { "customers:listAccessibleCustomers": {} } });
    const c = new AdsClient({ credentials: ads.credentials, fetchImpl: ads.fetchImpl, origin: ads.origin });
    expect(await listAccessibleCustomerIds(c)).toEqual([]);
  });
});

describe("describing one account", () => {
  it("returns the details a person would recognise", async () => {
    const c = withAccounts(["5932227642"], {
      "customers/5932227642/googleAds:search": customer(),
    });
    expect(await describeAccount(c, "5932227642")).toEqual({
      customerId: "5932227642",
      displayId: "593-222-7642",
      name: "Northridge Fabrication",
      currencyCode: "USD",
      timeZone: "America/New_York",
      isManager: false,
      status: "ENABLED",
    });
  });

  /*
   * An account with no name is ordinary, and its number is the only honest
   * label for it. Inventing "Untitled account" would be inventing data.
   */
  it("falls back to the account number rather than making a name up", async () => {
    const c = withAccounts(["5932227642"], {
      "customers/5932227642/googleAds:search": customer({ descriptiveName: "" }),
    });
    expect((await describeAccount(c, "5932227642"))?.name).toBe("593-222-7642");
  });

  it("returns null rather than throwing when Google refuses this one", async () => {
    const c = withAccounts(["5932227642"], {}, {
      "customers/5932227642/googleAds:search": {
        status: 403,
        errorCode: "USER_PERMISSION_DENIED",
        message: "Permission denied.",
      },
    });
    expect(await describeAccount(c, "5932227642")).toBeNull();
  });
});

describe("the list they choose from", () => {
  /*
   * A login that reaches fifteen accounts will often have one that is
   * suspended or that this developer token cannot read. Losing the whole list
   * to it would leave the advertiser with nothing to pick and no idea why.
   */
  it("keeps going when one account cannot be read, and counts it", async () => {
    const c = withAccounts(
      ["5932227642", "1234567890"],
      {
        "customers/5932227642/googleAds:search": customer(),
        "customers/1234567890/googleAds:search": customer({ id: "1234567890" }),
      },
      {
        "customers/1234567890/googleAds:search": {
          status: 403,
          errorCode: "USER_PERMISSION_DENIED",
          message: "Permission denied.",
        },
      }
    );

    const list = await listAccounts(c);
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0].customerId).toBe("5932227642");
    expect(list.unreadable).toBe(1);
  });

  it("leaves managers in the list rather than showing an empty screen", () => {
    const all = [account({ isManager: true, name: "Parent" }), account()];
    expect(all).toHaveLength(2);
    // But they are not offered as somewhere to send conversions.
    expect(usableAccounts(all).map((a) => a.name)).toEqual(["Northridge Fabrication"]);
  });

  it("does not offer a closed account", () => {
    expect(usableAccounts([account({ status: "CANCELED" })])).toEqual([]);
    expect(usableAccounts([account({ status: "CLOSED" })])).toEqual([]);
  });
});

describe("whether an account can carry this model", () => {
  it("accepts the ordinary case", () => {
    expect(checkAccount(account(), "USD")).toEqual({ ok: true, account: account() });
  });

  /*
   * The refusal that matters most and that nobody thinks of. Google accepts
   * every row of a GBP model uploaded into a USD account without complaint,
   * then prices every lead about 25% wrong for as long as it runs, with
   * nothing on any screen to say so.
   */
  it("refuses a currency mismatch, which Google would accept silently", () => {
    const result = checkAccount(account({ currencyCode: "GBP" }), "USD");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/USD/);
    expect(result.reason).toMatch(/GBP/);
    // It has to say what to do, not just that something is wrong.
    expect(result.reason).toMatch(/Refit the model|pick an account/);
  });

  it("says plainly that a manager account is the wrong one to pick", () => {
    const result = checkAccount(account({ isManager: true, name: "Parent" }), "USD");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/manager account/);
    expect(result.reason).toMatch(/where your ads actually run|ads actually run/);
  });

  it("refuses a closed account", () => {
    const result = checkAccount(account({ status: "CANCELED" }), "USD");
    expect(result.ok).toBe(false);
  });

  /*
   * An account whose currency Google did not report is not a mismatch. Refusing
   * it would block a connection over a field that is simply absent.
   */
  it("does not refuse an account whose currency is unknown", () => {
    expect(checkAccount(account({ currencyCode: null }), "USD").ok).toBe(true);
  });
});
