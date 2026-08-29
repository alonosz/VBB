import type { MappedDeal, DealOutcome } from "@/lib/analysis/types";
import type { CurrencyPolicy } from "@/lib/mapping/toDeals";
import type { HubSpotObject, HubSpotPull } from "./types";

/**
 * Turning HubSpot records into the shape the engine already understands.
 *
 * The CSV path asks the user which column is which, because a CSV export has
 * whatever headers someone chose. HubSpot does not need that: its standard
 * properties have fixed names, so the mapping is known in advance and there is
 * no mapping screen to get wrong.
 *
 * One thing genuinely is not standard — the ad click ID. HubSpot has no
 * property for it, so it arrives under whatever name the advertiser's form
 * used. We look under the names our own snippet writes and the ones the common
 * integrations use, and if none is present the leads simply match on email
 * instead. Guessing at a property that happens to hold a long opaque string
 * would be inventing data.
 */

/** Property names a Google click ID plausibly lives under, best first. */
export const CLICK_ID_PROPERTIES = [
  "gclid",
  "hs_google_click_id",
  "gclid__c",
  "google_click_id",
  "vbb_gclid",
  "gbraid",
  "wbraid",
];

/**
 * Picking the click-ID property out of a portal's own contact properties.
 *
 * The list above is a guess at what someone might have called it, and a guess
 * is not good enough: a real portal stores it under a property *labelled*
 * "Google Click ID", and if the internal name is not one we thought of, the
 * connection quietly produces zero click IDs and falls back to email with
 * nothing on screen saying why. So the portal is asked what it has.
 *
 * The exclusions matter as much as the matches. That same portal carries
 * "Facebook Click ID" and "LinkedIn Click ID" beside the Google one, and
 * sending an fbclid to Google Ads as though it were a gclid would attach a
 * value to nothing at all — a silent, confident mismatch, which is the worst
 * kind. Anything naming another network is left alone.
 */
const OTHER_NETWORKS = /facebook|fbclid|meta|linkedin|li_?fat|twitter|tiktok|ttclid|bing|microsoft|msclkid|reddit/i;

/** Google's own click identifiers: search, plus the iOS app-campaign pair. */
const GOOGLE_CLICK = /(^|[^a-z])(gclid|gbraid|wbraid)([^a-z]|$)|google.{0,12}click|click.{0,4}id/i;

export interface HubSpotPropertyRef {
  name: string;
  label?: string;
}

export function googleClickIdProperties(properties: HubSpotPropertyRef[]): string[] {
  const found: string[] = [];

  for (const p of properties) {
    const name = p.name ?? "";
    const label = p.label ?? "";
    const both = `${name} ${label}`;

    if (OTHER_NETWORKS.test(both)) continue;
    if (!GOOGLE_CLICK.test(name) && !GOOGLE_CLICK.test(label)) continue;
    found.push(name);
  }

  // The names we already know go first, so a portal with both a standard
  // property and a custom one is read in the order the old code would have.
  return [
    ...CLICK_ID_PROPERTIES.filter((k) => found.includes(k)),
    ...found.filter((k) => !CLICK_ID_PROPERTIES.includes(k)),
  ];
}

export const DEAL_PROPERTIES = [
  "dealname",
  "amount",
  // Without this, a portal that sells in more than one currency hands back
  // amounts that look comparable and are not. MappedDeal.amount is a
  // reporting-currency figure by contract, so the code has to come with it.
  "deal_currency_code",
  "dealstage",
  "pipeline",
  "closedate",
  "createdate",
  "hs_is_closed",
  "hs_is_closed_won",
];

export const CONTACT_PROPERTIES = ["email", "jobtitle", ...CLICK_ID_PROPERTIES];

export const COMPANY_PROPERTIES = ["numberofemployees", "industry", "name"];

function text(record: HubSpotObject | undefined, key: string): string | null {
  const value = record?.properties?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function number(record: HubSpotObject | undefined, key: string): number | null {
  const raw = text(record, key);
  if (raw === null) return null;
  // HubSpot returns numbers as strings, and a portal can hold "1,200" or "" in
  // a number field. Anything that does not parse cleanly is missing, not zero.
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function date(record: HubSpotObject | undefined, key: string): Date | null {
  const raw = text(record, key);
  if (raw === null) return null;
  // Epoch milliseconds on some properties, ISO on others.
  const parsed = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Won, lost or still open.
 *
 * Read from HubSpot's own computed flags rather than from stage names. A
 * portal can call its closed-won stage anything, and matching on the word
 * "won" would misread "Won back" and miss "Signed".
 */
export function outcomeOf(deal: HubSpotObject): DealOutcome {
  if (text(deal, "hs_is_closed_won") === "true") return "won";
  if (text(deal, "hs_is_closed") === "true") return "lost";
  return "open";
}

function firstAssociated(
  deal: HubSpotObject,
  kind: "contacts" | "companies",
  index: Map<string, HubSpotObject>
): HubSpotObject | undefined {
  const ids = deal.associations?.[kind]?.results ?? [];
  for (const { id } of ids) {
    const found = index.get(id);
    if (found) return found;
  }
  return undefined;
}

function clickIdOf(
  contact: HubSpotObject | undefined,
  keys: readonly string[]
): string | null {
  if (!contact) return null;
  for (const key of keys) {
    const value = text(contact, key);
    // The same shape the snippet enforces before storing one: long enough to
    // be a real token, and free of the punctuation an address carries.
    if (value && value.length >= 8 && /^[A-Za-z0-9_.-]+$/.test(value)) return value;
  }
  return null;
}

/**
 * Days from creation to first entering each stage.
 *
 * HubSpot records this as hs_date_entered_<stageId>, one property per stage of
 * every pipeline, so the names are portal-specific and are discovered from the
 * payload rather than listed. Stage ids are opaque, so labels are used when the
 * pipeline metadata came along and the id is kept when it did not — an
 * unreadable stage name is better than a wrong one.
 */
export function stageTimingOf(
  deal: HubSpotObject,
  createdAt: Date | null,
  stageLabels?: Map<string, string>
): Record<string, number> | undefined {
  if (!createdAt) return undefined;
  const out: Record<string, number> = {};

  for (const [key, raw] of Object.entries(deal.properties)) {
    const match = /^hs_date_entered_(.+)$/.exec(key);
    if (!match || !raw) continue;
    const entered = date(deal, key);
    if (!entered) continue;

    const days = (entered.getTime() - createdAt.getTime()) / 86_400_000;
    // A stage entered before the deal existed is a backfill artefact, not a
    // fast pipeline. stageTrustCheck catches the subtler cases; this one is
    // impossible rather than merely suspicious.
    if (!Number.isFinite(days) || days < 0) continue;

    const stageId = match[1];
    out[stageLabels?.get(stageId) ?? stageId] = days;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Which currencies this portal actually deals in, commonest first.
 *
 * Asked for before anything is priced, so a mixed portal can be given the same
 * treatment a mixed CSV gets — pick a reporting currency, set a rate, or leave
 * the minority out — rather than having its amounts quietly added together.
 */
export function currenciesInPull(pull: HubSpotPull): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const deal of pull.deals) {
    if (number(deal, "amount") === null) continue;
    const code = (text(deal, "deal_currency_code") ?? "").toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The same conversion rule the CSV path uses, so the two sources cannot
 * disagree about what an amount means.
 *
 * A deal with no currency code is taken at face value. Older portals and
 * single-currency ones do not always return the property, and nulling every
 * amount because HubSpot omitted a field would break the common case to guard
 * against the rare one.
 */
function convertAmount(
  amount: number,
  code: string | null,
  policy: CurrencyPolicy | null | undefined
): number | null {
  if (!policy || !code) return amount;
  const from = code.trim().toUpperCase();
  if (!from || from === policy.reportingCurrency.toUpperCase()) return amount;
  const rate = policy.rates[from];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(amount * rate * 100) / 100;
}

export function hubspotToDeals(
  pull: HubSpotPull,
  currency?: CurrencyPolicy | null
): MappedDeal[] {
  const deals: MappedDeal[] = [];

  for (const deal of pull.deals) {
    const contact = firstAssociated(deal, "contacts", pull.contactsById);
    const company = firstAssociated(deal, "companies", pull.companiesById);
    const createdAt = date(deal, "createdate");
    const stageId = text(deal, "dealstage");

    deals.push({
      id: deal.id,
      createdAt,
      closedAt: date(deal, "closedate"),
      outcome: outcomeOf(deal),
      amount: (() => {
        const raw = number(deal, "amount");
        if (raw === null) return null;
        return convertAmount(raw, text(deal, "deal_currency_code"), currency);
      })(),
      stage: stageId ? pull.stageLabels?.get(stageId) ?? stageId : null,
      // HubSpot's own attribution, not ours to infer.
      source: text(contact, "hs_analytics_source") ?? null,
      email: text(contact, "email"),
      clickId: clickIdOf(contact, pull.clickIdProperties ?? CLICK_ID_PROPERTIES),
      employeeCount: number(company, "numberofemployees"),
      industry: text(company, "industry"),
      contactTitle: text(contact, "jobtitle"),
      stageReachedAfterDays: stageTimingOf(deal, createdAt, pull.stageLabels),
    });
  }

  return deals;
}
