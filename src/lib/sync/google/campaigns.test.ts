import { describe, expect, it } from "vitest";
import { AdsClient } from "./client";
import { fakeAds } from "./fakeAds";
import {
  auditStrategies,
  CAMPAIGN_QUERY,
  fromMicros,
  judgeStrategy,
  readCampaigns,
  strategyLabel,
  type CampaignRow,
} from "./campaigns";

const CUSTOMER = "5932227642";
const SEARCH = `customers/${CUSTOMER}/googleAds:search`;

function client(results: unknown[]) {
  const fake = fakeAds({ responses: { [SEARCH]: { results } } });
  return {
    fake,
    client: new AdsClient({
      credentials: fake.credentials,
      fetchImpl: fake.fetchImpl,
      origin: fake.origin,
    }),
  };
}

function campaign(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "1",
    name: "Brand",
    status: "ENABLED",
    biddingStrategyType: "MAXIMIZE_CONVERSIONS",
    strategyLabel: "Maximize conversions",
    verdict: "ignores-value",
    cost: 1000,
    conversions: 20,
    conversionValue: 0,
    ...over,
  };
}

describe("judging a bid strategy", () => {
  /*
   * The distinction the whole feature rests on. These two spend differently
   * because of a conversion value; everything else bids on how many leads
   * arrive and ignores what we send entirely.
   */
  it("knows the two that actually use conversion value", () => {
    expect(judgeStrategy("MAXIMIZE_CONVERSION_VALUE")).toBe("uses-value");
    expect(judgeStrategy("TARGET_ROAS")).toBe("uses-value");
  });

  it("knows the ones that bid on lead count", () => {
    expect(judgeStrategy("MAXIMIZE_CONVERSIONS")).toBe("ignores-value");
    expect(judgeStrategy("TARGET_CPA")).toBe("ignores-value");
    expect(judgeStrategy("MANUAL_CPC")).toBe("ignores-value");
  });

  /*
   * Google adds strategies. An unfamiliar one is reported as unknown rather
   * than accused of ignoring value, because telling an advertiser to change a
   * setting on evidence we do not have is worse than saying nothing.
   */
  it("says unknown for a strategy it has not been taught", () => {
    expect(judgeStrategy("SOME_NEW_STRATEGY_2027")).toBe("unknown");
    expect(judgeStrategy(null)).toBe("unknown");
    expect(judgeStrategy("TARGET_IMPRESSION_SHARE")).toBe("unknown");
  });

  it("names strategies the way the Google Ads screen does", () => {
    expect(strategyLabel("MAXIMIZE_CONVERSION_VALUE")).toBe("Maximize conversion value");
    expect(strategyLabel("TARGET_CPA")).toBe("Target CPA");
    // An unknown one is still readable rather than shouted in constant case.
    expect(strategyLabel("SOME_NEW_THING")).toBe("some new thing");
  });
});

describe("reading them back", () => {
  it("asks only for campaigns that are running", () => {
    expect(CAMPAIGN_QUERY).toContain("campaign.status = 'ENABLED'");
    expect(CAMPAIGN_QUERY).toContain("LAST_30_DAYS");
  });

  it("turns Google's micros into money", () => {
    expect(fromMicros("1234560000")).toBe(1234.56);
    expect(fromMicros(0)).toBe(0);
    expect(fromMicros(undefined)).toBe(0);
  });

  it("reads a campaign with its strategy and spend", async () => {
    const { client: c } = client([
      {
        campaign: { id: "11", name: "Search - Brand", status: "ENABLED", biddingStrategyType: "TARGET_CPA" },
        metrics: { costMicros: "4200000000", conversions: "31", conversionsValue: "0" },
      },
    ]);
    expect(await readCampaigns(c, CUSTOMER)).toEqual([
      {
        id: "11",
        name: "Search - Brand",
        status: "ENABLED",
        biddingStrategyType: "TARGET_CPA",
        strategyLabel: "Target CPA",
        verdict: "ignores-value",
        cost: 4200,
        conversions: 31,
        conversionValue: 0,
      },
    ]);
  });

  it("returns nothing rather than throwing on an account with no campaigns", async () => {
    const { client: c } = client([]);
    expect(await readCampaigns(c, CUSTOMER)).toEqual([]);
  });
});

describe("the audit", () => {
  /*
   * Weighted by spend, not by campaign count. "Three of your five campaigns
   * ignore conversion value" sounds alarming and means nothing when those
   * three are two percent of the money.
   */
  it("measures the money, not the number of campaigns", () => {
    const audit = auditStrategies([
      campaign({ id: "1", name: "Big", biddingStrategyType: "MAXIMIZE_CONVERSION_VALUE", verdict: "uses-value", cost: 9800 }),
      campaign({ id: "2", name: "Tiny A", cost: 100 }),
      campaign({ id: "3", name: "Tiny B", cost: 60 }),
      campaign({ id: "4", name: "Tiny C", cost: 40 }),
    ]);
    expect(audit.ignoring).toHaveLength(3);
    expect(audit.spendIgnoringValue).toBe(200);
    expect(audit.totalSpend).toBe(10000);
    expect(audit.shareIgnoringValue).toBe(0.02);
  });

  it("puts the most expensive offender first", () => {
    const audit = auditStrategies([
      campaign({ id: "1", name: "Small", cost: 50 }),
      campaign({ id: "2", name: "Huge", cost: 9000 }),
      campaign({ id: "3", name: "Middling", cost: 400 }),
    ]);
    expect(audit.ignoring.map((c) => c.name)).toEqual(["Huge", "Middling", "Small"]);
  });

  it("does not accuse a campaign on an unrecognised strategy", () => {
    const audit = auditStrategies([
      campaign({ biddingStrategyType: "SOMETHING_NEW", verdict: "unknown", cost: 5000 }),
    ]);
    expect(audit.ignoring).toEqual([]);
    expect(audit.spendIgnoringValue).toBe(0);
  });

  it("does not divide by zero on an account that has spent nothing", () => {
    const audit = auditStrategies([campaign({ cost: 0 })]);
    expect(audit.shareIgnoringValue).toBe(0);
    expect(Number.isFinite(audit.shareIgnoringValue)).toBe(true);
  });

  it("reports a clean account as clean", () => {
    const audit = auditStrategies([
      campaign({ biddingStrategyType: "TARGET_ROAS", verdict: "uses-value", cost: 5000 }),
    ]);
    expect(audit.ignoring).toEqual([]);
    expect(audit.shareIgnoringValue).toBe(0);
    expect(audit.totalSpend).toBe(5000);
  });
});
