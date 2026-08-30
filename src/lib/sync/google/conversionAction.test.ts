import { describe, expect, it } from "vitest";
import { AdsClient } from "./client";
import { fakeAds, type FakeAdsOptions } from "./fakeAds";
import {
  CLICK_LOOKBACK_DAYS,
  CONVERSION_ACTION_NAME,
  conversionActionPayload,
  ensureConversionAction,
  findConversionAction,
} from "./conversionAction";
import { CONVERSION_NAME } from "@/lib/feed/handlers";

const CUSTOMER = "5932227642";
const SEARCH = `customers/${CUSTOMER}/googleAds:search`;
const MUTATE = `customers/${CUSTOMER}/conversionActions:mutate`;

function ads(responses: FakeAdsOptions["responses"] = {}, failures: FakeAdsOptions["failures"] = {}) {
  const fake = fakeAds({ responses, failures });
  return {
    fake,
    client: new AdsClient({
      credentials: fake.credentials,
      fetchImpl: fake.fetchImpl,
      origin: fake.origin,
    }),
  };
}

const RESOURCE = `customers/${CUSTOMER}/conversionActions/98765`;

describe("the settings on the action we create", () => {
  const payload = conversionActionPayload();

  /*
   * The setting the whole product depends on. "Use one value for each
   * conversion" flattens every lead back to a single number, which is exactly
   * the problem this exists to solve, and nothing on any screen would say so.
   */
  it("takes the value from each row rather than using one default", () => {
    expect(payload.valueSettings.alwaysUseDefaultValue).toBe(false);
    // No default value is set at all: a default here would be a number we
    // invented, applied to leads we could not price.
    expect(payload.valueSettings).not.toHaveProperty("defaultValue");
  });

  /*
   * "Include in Conversions" under its current name. Without it Google
   * records the conversion, reports it, and Smart Bidding ignores it - which
   * looks identical to everything working.
   */
  it("is included in Conversions, so Smart Bidding actually optimises to it", () => {
    expect(payload.primaryForGoal).toBe(true);
  });

  it("counts one conversion per click, so a restatement is not a second lead", () => {
    expect(payload.countingType).toBe("ONE_PER_CLICK");
  });

  it("is an upload action with a window long enough for a lead-gen cycle", () => {
    expect(payload.type).toBe("UPLOAD_CLICKS");
    expect(payload.clickThroughLookbackWindowDays).toBe(CLICK_LOOKBACK_DAYS);
    expect(CLICK_LOOKBACK_DAYS).toBe(90);
    expect(payload.status).toBe("ENABLED");
  });

  /*
   * Google matches an uploaded row to a conversion action by name. If the name
   * we create and the name we upload against ever drift, every row is
   * discarded and no error reaches anybody.
   */
  it("uses the same name the feed route uploads against", () => {
    expect(CONVERSION_ACTION_NAME).toBe(CONVERSION_NAME);
    expect(payload.name).toBe(CONVERSION_NAME);
  });
});

describe("finding one that already exists", () => {
  it("returns the existing action rather than a second one", async () => {
    const { client } = ads({
      [SEARCH]: {
        results: [
          { conversionAction: { resourceName: RESOURCE, name: CONVERSION_NAME, status: "ENABLED" } },
        ],
      },
    });
    expect(await findConversionAction(client, CUSTOMER)).toEqual({
      resourceName: RESOURCE,
      name: CONVERSION_NAME,
      existed: true,
    });
  });

  it("returns null when the account has none", async () => {
    const { client } = ads({ [SEARCH]: { results: [] } });
    expect(await findConversionAction(client, CUSTOMER)).toBeNull();
  });

  it("asks only for actions that are not removed", async () => {
    const { fake, client } = ads({ [SEARCH]: { results: [] } });
    await findConversionAction(client, CUSTOMER);
    const query = String((fake.calls[0].body as { query: string }).query);
    expect(query).toContain("status != 'REMOVED'");
    expect(query).toContain(`conversion_action.name = '${CONVERSION_NAME}'`);
  });

  it("escapes a quote in the name rather than breaking the query", async () => {
    const { fake, client } = ads({ [SEARCH]: { results: [] } });
    await findConversionAction(client, CUSTOMER, "Bob's Leads");
    const query = String((fake.calls[0].body as { query: string }).query);
    expect(query).toContain("'Bob\\'s Leads'");
  });
});

describe("ensuring it is there", () => {
  it("creates one when the account has none", async () => {
    const { fake, client } = ads({
      [SEARCH]: { results: [] },
      [MUTATE]: { results: [{ resourceName: RESOURCE }] },
    });

    const ref = await ensureConversionAction(client, CUSTOMER);
    expect(ref).toEqual({ resourceName: RESOURCE, name: CONVERSION_NAME, existed: false });

    const create = (fake.calls[1].body as { operations: { create: Record<string, unknown> }[] })
      .operations[0].create;
    expect(create).toMatchObject({ name: CONVERSION_NAME, type: "UPLOAD_CLICKS" });
  });

  /*
   * Pressing the button twice, reconnecting, or refitting must not leave an
   * account with "VBB Lead Value" and "VBB Lead Value (1)". Google would take
   * both, uploads would name one, and the advertiser's reporting would split
   * in two with no explanation.
   */
  it("does not create a second one when it is already there", async () => {
    const { fake, client } = ads({
      [SEARCH]: {
        results: [{ conversionAction: { resourceName: RESOURCE, name: CONVERSION_NAME } }],
      },
    });

    const ref = await ensureConversionAction(client, CUSTOMER);
    expect(ref.existed).toBe(true);
    expect(fake.calls.map((c) => c.path)).not.toContain(MUTATE);
  });

  it("says so rather than returning a reference to nothing", async () => {
    const { client } = ads({ [SEARCH]: { results: [] }, [MUTATE]: { results: [] } });
    await expect(ensureConversionAction(client, CUSTOMER)).rejects.toThrow(/did not return/i);
  });

  it("lets a refusal from Google through with its reason", async () => {
    const { client } = ads(
      { [SEARCH]: { results: [] } },
      {
        [MUTATE]: {
          status: 403,
          errorCode: "USER_PERMISSION_DENIED",
          message: "The caller does not have permission to create conversion actions.",
        },
      }
    );
    await expect(ensureConversionAction(client, CUSTOMER)).rejects.toThrow(/does not have permission/);
  });
});
