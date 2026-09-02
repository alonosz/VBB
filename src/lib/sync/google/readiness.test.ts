import { describe, expect, it } from "vitest";
import { AdsClient } from "./client";
import { fakeAds } from "./fakeAds";
import { READINESS_QUERY, judgeReadiness, readReadiness } from "./readiness";

const check = (r: ReturnType<typeof judgeReadiness>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("judgeReadiness", () => {
  it("passes an account that has everything Google needs", () => {
    const r = judgeReadiness({
      conversionTrackingStatus: "CONVERSION_TRACKING_MANAGED_BY_SELF",
      acceptedCustomerDataTerms: true,
      enhancedConversionsForLeadsEnabled: true,
    });
    expect(r.clear).toBe(true);
    expect(r.blocksEmail).toBe(false);
    expect(r.checks.every((c) => c.state === "ready")).toBe(true);
    // Nothing to do is said by having nothing to do, not by a cheerful string.
    expect(r.checks.every((c) => c.fix === "")).toBe(true);
  });

  /*
   * The refusal that killed the first real send. It has to be visible before
   * the send, and it has to name the four clicks.
   */
  it("catches unaccepted customer data terms and says where they are", () => {
    const r = judgeReadiness({
      conversionTrackingStatus: "CONVERSION_TRACKING_MANAGED_BY_SELF",
      acceptedCustomerDataTerms: false,
      enhancedConversionsForLeadsEnabled: true,
    });
    expect(r.clear).toBe(false);
    expect(check(r, "customerDataTerms").state).toBe("not-ready");
    expect(check(r, "customerDataTerms").fix).toContain("Customer data terms");
  });

  /*
   * Enhanced conversions for leads is the one failure that is conditional on
   * the feed. A click-ID-only send needs nothing from it, so it must not
   * block the whole screen - it reports separately.
   */
  it("treats a missing leads setting as blocking email only, not the send", () => {
    const r = judgeReadiness({
      conversionTrackingStatus: "CONVERSION_TRACKING_MANAGED_BY_SELF",
      acceptedCustomerDataTerms: true,
      enhancedConversionsForLeadsEnabled: false,
    });
    expect(r.blocksEmail).toBe(true);
    expect(r.clear).toBe(true);
    expect(check(r, "enhancedConversionsForLeads").fix).toMatch(/click ID goes through without it/);
  });

  it("names an account that tracks no conversions at all", () => {
    const r = judgeReadiness({
      conversionTrackingStatus: "NOT_CONVERSION_TRACKED",
      acceptedCustomerDataTerms: true,
      enhancedConversionsForLeadsEnabled: true,
    });
    expect(r.clear).toBe(false);
    expect(check(r, "conversionTracking").state).toBe("not-ready");
  });

  /*
   * A field Google did not return is Google declining to say, not evidence the
   * setting is wrong. Blocking on it would send somebody to fix a setting that
   * is already correct, which costs exactly the trust this screen is for.
   */
  it("reports a field Google did not return as unknown, and does not block on it", () => {
    const r = judgeReadiness({});
    expect(r.checks.every((c) => c.state === "unknown")).toBe(true);
    expect(r.clear).toBe(true);
    expect(r.blocksEmail).toBe(false);
    expect(r.checks.every((c) => c.fix === "")).toBe(true);
    expect(r.checks.every((c) => /did not say/.test(c.title))).toBe(true);
  });
});

describe("readReadiness", () => {
  it("asks the account rather than assuming, and reads what it says", async () => {
    const fake = fakeAds({
      responses: {
        "customers/5932227642/googleAds:search": {
          results: [
            {
              customer: {
                conversionTrackingSetting: {
                  conversionTrackingStatus: "CONVERSION_TRACKING_MANAGED_BY_SELF",
                  acceptedCustomerDataTerms: false,
                  enhancedConversionsForLeadsEnabled: false,
                },
              },
            },
          ],
        },
      },
    });
    const client = new AdsClient({
      credentials: {
        accessToken: "token",
        developerToken: "dev-token-test",
        loginCustomerId: null,
      },
      fetchImpl: fake.fetchImpl,
      origin: "https://ads.test",
    });

    const r = await readReadiness(client, "5932227642");
    expect(r.clear).toBe(false);
    expect(r.blocksEmail).toBe(true);

    const [call] = fake.calls;
    expect(call.path).toBe("customers/5932227642/googleAds:search");
    expect(call.body).toEqual({ query: READINESS_QUERY });
  });

  /*
   * An account that returns no row is not an account with everything switched
   * off. Reading it as three failures would send somebody to fix settings that
   * may be perfectly fine.
   */
  it("reads an empty answer as unknown rather than as three failures", async () => {
    const fake = fakeAds({
      responses: { "customers/1/googleAds:search": { results: [] } },
    });
    const client = new AdsClient({
      credentials: { accessToken: "t", developerToken: "dev-token-test", loginCustomerId: null },
      fetchImpl: fake.fetchImpl,
      origin: "https://ads.test",
    });
    const r = await readReadiness(client, "1");
    expect(r.checks.every((c) => c.state === "unknown")).toBe(true);
    expect(r.clear).toBe(true);
  });
});
