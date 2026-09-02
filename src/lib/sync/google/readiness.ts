import type { AdsClient } from "./client";

/**
 * What is wrong with the account, before anything is sent to it.
 *
 * Google's offline conversion settings live on four screens that do not
 * mention each other, and the API does not complain about any of them until
 * the moment values are submitted - at which point it refuses the whole batch
 * and names a field, not a fix. The first real send of this product died that
 * way: the account had not accepted the customer data terms, nothing on any
 * screen said so, and the only signal was a rejection after the fact.
 *
 * A person building the product can push through that. A design partner
 * reads a red wall on their first attempt and quietly stops, and nobody ever
 * finds out why. So the same facts are read up front, from the account
 * itself, and shown as a list they can finish before pressing anything.
 *
 * Every check here is read-only and answers from the account rather than from
 * an assumption. Where Google does not expose a fact, this says it does not
 * know, rather than guessing green.
 */

export type CheckState = "ready" | "not-ready" | "unknown";

export interface ReadinessCheck {
  id: "customerDataTerms" | "enhancedConversionsForLeads" | "conversionTracking";
  state: CheckState;
  /** What the account said, in the advertiser's words. */
  title: string;
  /** Empty when ready. Where to click, otherwise. */
  fix: string;
}

export interface AccountReadiness {
  checks: ReadinessCheck[];
  /** True when nothing here will refuse a send. */
  clear: boolean;
  /**
   * True when the account will refuse rows carrying an email address.
   *
   * Separate from `clear` because it is only fatal for a feed that has emails
   * in it. A click-ID-only send goes through an account that has never heard
   * of enhanced conversions for leads.
   */
  blocksEmail: boolean;
}

export const READINESS_QUERY =
  "SELECT customer.id, " +
  "customer.conversion_tracking_setting.conversion_tracking_status, " +
  "customer.conversion_tracking_setting.accepted_customer_data_terms, " +
  "customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled " +
  "FROM customer LIMIT 1";

interface ReadinessResponse {
  results?: {
    customer?: {
      conversionTrackingSetting?: {
        conversionTrackingStatus?: string;
        acceptedCustomerDataTerms?: boolean;
        enhancedConversionsForLeadsEnabled?: boolean;
      };
    };
  }[];
}

/** Google reports "not tracking" in more than one spelling. */
const NOT_TRACKING = new Set(["NOT_CONVERSION_TRACKED", "UNKNOWN", "UNSPECIFIED"]);

/**
 * @param setting What the account reported. Undefined fields become "unknown"
 *   rather than "not ready": an absent field is Google declining to say, and
 *   telling somebody to fix a setting that is already correct wastes the trust
 *   this screen exists to build.
 */
export function judgeReadiness(setting: {
  conversionTrackingStatus?: string;
  acceptedCustomerDataTerms?: boolean;
  enhancedConversionsForLeadsEnabled?: boolean;
}): AccountReadiness {
  const checks: ReadinessCheck[] = [];

  const terms = setting.acceptedCustomerDataTerms;
  checks.push({
    id: "customerDataTerms",
    state: terms === undefined ? "unknown" : terms ? "ready" : "not-ready",
    title: terms
      ? "Customer data terms accepted"
      : terms === false
        ? "Customer data terms not accepted"
        : "Customer data terms: Google did not say",
    fix: terms === false
      ? "Google Ads: Goals → Conversions → Settings → Customer data terms. Read and accept them. Nothing can be uploaded to this account until you do."
      : "",
  });

  const ecl = setting.enhancedConversionsForLeadsEnabled;
  checks.push({
    id: "enhancedConversionsForLeads",
    state: ecl === undefined ? "unknown" : ecl ? "ready" : "not-ready",
    title: ecl
      ? "Enhanced conversions for leads is on"
      : ecl === false
        ? "Enhanced conversions for leads is off"
        : "Enhanced conversions for leads: Google did not say",
    fix: ecl === false
      ? "Only needed for leads matched by email address; a lead with an ad click ID goes through without it. Google Ads: Goals → Conversions → Settings → Enhanced conversions for leads. Tick it on and pick Google tag, unless your site is tagged through Tag Manager."
      : "",
  });

  const status = setting.conversionTrackingStatus;
  const tracking = status === undefined ? undefined : !NOT_TRACKING.has(status);
  checks.push({
    id: "conversionTracking",
    state: tracking === undefined ? "unknown" : tracking ? "ready" : "not-ready",
    title: tracking
      ? "Conversion tracking is set up"
      : tracking === false
        ? "This account is not tracking conversions"
        : "Conversion tracking: Google did not say",
    fix: tracking === false
      ? "Values can still be uploaded, but no campaign can bid on them until the account tracks conversions at all. Google Ads: Goals → Conversions → Summary."
      : "",
  });

  /*
   * Unknown does not block. Google declining to report a field is not evidence
   * the setting is wrong, and a checklist that refuses to let somebody proceed
   * over a field it could not read is worse than the rejection it replaced.
   */
  const blocking = checks.filter(
    (c) => c.state === "not-ready" && c.id !== "enhancedConversionsForLeads"
  );

  return {
    checks,
    clear: blocking.length === 0,
    blocksEmail:
      checks.find((c) => c.id === "enhancedConversionsForLeads")?.state === "not-ready",
  };
}

export async function readReadiness(
  client: AdsClient,
  customerId: string
): Promise<AccountReadiness> {
  const res = await client.post<ReadinessResponse>(
    `customers/${customerId}/googleAds:search`,
    { query: READINESS_QUERY }
  );
  return judgeReadiness(res.results?.[0]?.customer?.conversionTrackingSetting ?? {});
}
