import type { AdsClient } from "./client";
import { MIN_LEADS_PER_MONTH } from "@/lib/analysis/volume";

/**
 * Is Google actually using the values we send?
 *
 * The question the feed route can never answer, and the one that decides
 * whether any of this worked. An advertiser can map every column correctly,
 * publish a perfect feed, watch Google collect it, and see nothing change -
 * because Maximize Conversions and Target CPA bid on how many leads arrive and
 * ignore what they are worth. The values land, are stored, are reported, and
 * change no bid.
 *
 * Nothing in Google Ads tells them this. It is not an error, it is a setting,
 * and the two screens are nowhere near each other.
 */

/** The two that actually spend differently because of a conversion value. */
export const VALUE_STRATEGIES = ["MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"];

/**
 * Strategies that optimise for the count of conversions, not their value.
 *
 * Named explicitly rather than treated as "anything not in the list above",
 * because Google adds strategies and an unknown one should be reported as
 * unknown rather than quietly accused of ignoring value.
 */
export const COUNT_STRATEGIES = [
  "MAXIMIZE_CONVERSIONS",
  "TARGET_CPA",
  "TARGET_SPEND",
  "MANUAL_CPC",
  "MANUAL_CPM",
  "MANUAL_CPV",
  "PERCENT_CPC",
];

export type StrategyVerdict = "uses-value" | "ignores-value" | "unknown";

export function judgeStrategy(biddingStrategyType: string | null): StrategyVerdict {
  if (!biddingStrategyType) return "unknown";
  if (VALUE_STRATEGIES.includes(biddingStrategyType)) return "uses-value";
  if (COUNT_STRATEGIES.includes(biddingStrategyType)) return "ignores-value";
  return "unknown";
}

/** How Google writes a bid strategy, in the words the Google Ads screen uses. */
export function strategyLabel(biddingStrategyType: string | null): string {
  const named: Record<string, string> = {
    MAXIMIZE_CONVERSION_VALUE: "Maximize conversion value",
    TARGET_ROAS: "Target ROAS",
    MAXIMIZE_CONVERSIONS: "Maximize conversions",
    TARGET_CPA: "Target CPA",
    TARGET_SPEND: "Maximize clicks",
    MANUAL_CPC: "Manual CPC",
    MANUAL_CPM: "Manual CPM",
    MANUAL_CPV: "Manual CPV",
    PERCENT_CPC: "Percent CPC",
    TARGET_IMPRESSION_SHARE: "Target impression share",
  };
  if (!biddingStrategyType) return "Unknown";
  return named[biddingStrategyType] ?? biddingStrategyType.toLowerCase().replace(/_/g, " ");
}

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  biddingStrategyType: string | null;
  strategyLabel: string;
  verdict: StrategyVerdict;
  /** Real currency, not micros. */
  cost: number;
  conversions: number;
  conversionValue: number;
}

interface SearchResponse {
  results?: {
    campaign?: {
      id?: string;
      name?: string;
      status?: string;
      biddingStrategyType?: string;
    };
    metrics?: {
      costMicros?: string | number;
      conversions?: string | number;
      conversionsValue?: string | number;
    };
  }[];
}

/**
 * Only campaigns that are actually running and actually spending.
 *
 * A paused campaign on the wrong bid strategy is not a problem to raise: it
 * costs nothing and changing it changes nothing. Reporting it would bury the
 * ones that matter in a list nobody reads to the end.
 */
export const CAMPAIGN_QUERY =
  "SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type, " +
  "metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
  "FROM campaign WHERE campaign.status = 'ENABLED' AND segments.date DURING LAST_30_DAYS";

/** Google reports money in millionths. */
export function fromMicros(micros: string | number | undefined): number {
  const n = typeof micros === "string" ? Number(micros) : micros;
  return Number.isFinite(n) ? (n as number) / 1_000_000 : 0;
}

function num(value: string | number | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? (n as number) : 0;
}

export async function readCampaigns(
  client: AdsClient,
  customerId: string
): Promise<CampaignRow[]> {
  const res = await client.post<SearchResponse>(`customers/${customerId}/googleAds:search`, {
    query: CAMPAIGN_QUERY,
  });

  return (res.results ?? []).map((r) => {
    const type = r.campaign?.biddingStrategyType ?? null;
    return {
      id: r.campaign?.id ?? "",
      // A campaign with no name is not something to invent one for.
      name: r.campaign?.name?.trim() || r.campaign?.id || "Unnamed campaign",
      status: r.campaign?.status ?? "UNKNOWN",
      biddingStrategyType: type,
      strategyLabel: strategyLabel(type),
      verdict: judgeStrategy(type),
      cost: fromMicros(r.metrics?.costMicros),
      conversions: num(r.metrics?.conversions),
      conversionValue: num(r.metrics?.conversionsValue),
    };
  });
}

export interface StrategyAudit {
  campaigns: CampaignRow[];
  /** The ones bidding on lead count, worst spend first. */
  ignoring: CampaignRow[];
  /** Spend on strategies that ignore value, over the window. */
  spendIgnoringValue: number;
  totalSpend: number;
  /** 0-1. The number that decides whether this matters at all. */
  shareIgnoringValue: number;
  /** Value-strategy campaigns starving under the learning floor, worst first. */
  underVolume: CampaignRow[];
  /** Conversions across all value-strategy campaigns, last 30 days. */
  valueConversions: number;
  /**
   * The silent failure mode: together the value campaigns clear the floor,
   * separately none does. Each campaign learns on its own conversions (unless
   * they share a portfolio bid strategy), so this account has enough volume
   * and no campaign that can use it.
   */
  splitVolume: boolean;
}

/**
 * The audit, weighted by spend rather than by campaign count.
 *
 * "Three of your five campaigns ignore conversion value" sounds alarming and
 * means nothing if those three are two percent of spend. What decides whether
 * this is worth an advertiser's afternoon is how much money is going through
 * a strategy that cannot act on what we send.
 */
export function auditStrategies(campaigns: CampaignRow[]): StrategyAudit {
  const ignoring = campaigns
    .filter((c) => c.verdict === "ignores-value")
    .sort((a, b) => b.cost - a.cost);

  const spendIgnoringValue = ignoring.reduce((sum, c) => sum + c.cost, 0);
  const totalSpend = campaigns.reduce((sum, c) => sum + c.cost, 0);

  /*
   * Volume is judged only on the campaigns already bidding on value. A
   * count-strategy campaign short of conversions has a different problem, and
   * it is the one the strategy warning above already covers.
   */
  const valueCampaigns = campaigns.filter((c) => c.verdict === "uses-value");
  const underVolume = valueCampaigns
    .filter((c) => c.conversions < MIN_LEADS_PER_MONTH)
    .sort((a, b) => b.cost - a.cost);
  const valueConversions = valueCampaigns.reduce((sum, c) => sum + c.conversions, 0);

  return {
    campaigns,
    ignoring,
    spendIgnoringValue,
    totalSpend,
    shareIgnoringValue: totalSpend > 0 ? spendIgnoringValue / totalSpend : 0,
    underVolume,
    valueConversions,
    splitVolume:
      valueCampaigns.length > 1 &&
      valueConversions >= MIN_LEADS_PER_MONTH &&
      underVolume.length === valueCampaigns.length,
  };
}
