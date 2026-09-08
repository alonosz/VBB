import type { MappedDeal, DealOutcome } from "@/lib/analysis/types";
import type { CurrencyPolicy } from "@/lib/mapping/toDeals";
import type { HubSpotObject, HubSpotPropertyDef, HubSpotPull, SignalProperty } from "./types";

/**
 * Turning HubSpot records into the shape the engine already understands.
 *
 * The CSV path asks the user which column is which, because a CSV export has
 * whatever headers someone chose. HubSpot does not need that: its standard
 * properties have fixed names, so the mapping is known in advance and there is
 * no mapping screen to get wrong.
 *
 * One thing genuinely is not standard - the ad click ID. HubSpot has no
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
 * value to nothing at all - a silent, confident mismatch, which is the worst
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

/**
 * hs_analytics_source is HubSpot's own first-touch attribution. It was read
 * off the contact and never requested, so every HubSpot lead arrived with no
 * source and the channel table was empty for anyone on the connection.
 */
export const CONTACT_PROPERTIES = ["email", "jobtitle", "hs_analytics_source", ...CLICK_ID_PROPERTIES];

/**
 * What a contact needs to carry to be a lead in its own right: when it
 * arrived, what HubSpot thinks became of it, and which company it belongs to
 * when no deal says so.
 */
export const LEAD_PROPERTIES = ["createdate", "lifecyclestage", "hs_lead_status", "associatedcompanyid"];

export const COMPANY_PROPERTIES = ["numberofemployees", "industry", "name"];

/**
 * The portal's own dropdowns, read as value signals.
 *
 * Until now the pull asked for a fixed list of standard properties and
 * nothing else, so a consumer business on HubSpot with a "Product line" or
 * "Coverage tier" property never saw it discovered - it never arrived. On
 * the file route those columns are what the whole model is priced on, which
 * made the connection quietly B2B-only.
 *
 * What is taken: single-choice enumerations (dropdown, radio) and booleans,
 * because those are categories by construction and carry no free text. What
 * is not: text properties (notes, names, addresses - a category is words the
 * portal enumerated, not words a rep typed), multi-select checkboxes (one
 * cell carrying several values is not one level), numbers and dates (the
 * detector already treats them as structural), and anything hidden or
 * calculated. HubSpot's own properties stay out apart from a short list that
 * genuinely describes the lead; the rest are system fields, and two of them
 * (lifecycle stage, lead status) are the outcome wearing another name.
 */
export const MAX_SIGNAL_PROPERTIES = 30;

const HUBSPOT_OWN_SIGNALS: Record<SignalProperty["object"], readonly string[]> = {
  deals: ["dealtype", "hs_priority"],
  contacts: [],
};

/** Structural or outcome-bearing, never a signal, however a portal defined them. */
const NEVER_SIGNALS = new Set([
  "dealstage", "pipeline", "hs_is_closed", "hs_is_closed_won", "deal_currency_code",
  "lifecyclestage", "hs_lead_status", "hs_analytics_source",
]);

function signalKind(def: HubSpotPropertyDef): SignalProperty["kind"] | null {
  if (def.type === "bool") return "bool";
  if (def.type === "enumeration" && (def.fieldType === "select" || def.fieldType === "radio")) {
    return "enumeration";
  }
  return null;
}

/**
 * @param taken Headers already in use. Mutated: every header handed out is
 *   added, so a second call for another object cannot collide with the first.
 */
export function signalPropertiesOf(
  defs: HubSpotPropertyDef[],
  object: SignalProperty["object"],
  taken: Set<string> = new Set(),
  limit: number = MAX_SIGNAL_PROPERTIES
): SignalProperty[] {
  const eligible = defs
    .filter((d) => typeof d.name === "string" && !d.hidden && !d.calculated)
    .filter((d) => !NEVER_SIGNALS.has(d.name))
    .filter((d) => !d.hubspotDefined || HUBSPOT_OWN_SIGNALS[object].includes(d.name))
    .filter((d) => signalKind(d) !== null)
    // The portal's own properties first: they are the ones somebody made on
    // purpose. Then by label, so the cap cuts the same way every night.
    .sort((a, b) =>
      Number(!!a.hubspotDefined) - Number(!!b.hubspotDefined) ||
      (a.label ?? a.name).localeCompare(b.label ?? b.name)
    );

  const out: SignalProperty[] = [];
  for (const def of eligible) {
    if (out.length >= limit) break;
    const base = (def.label ?? def.name).trim() || def.name;
    let header = base;
    if (taken.has(header)) header = `${base} (${object === "deals" ? "deal" : "contact"})`;
    for (let n = 2; taken.has(header); n++) header = `${base} (${n})`;
    taken.add(header);

    const options: Record<string, string> = {};
    for (const o of def.options ?? []) {
      if (typeof o.value === "string" && typeof o.label === "string") options[o.value] = o.label;
    }
    out.push({ object, name: def.name, header, options, kind: signalKind(def)! });
  }
  return out;
}

/** One deal's signals, in the words the portal shows rather than stores. */
export function signalsOf(
  deal: HubSpotObject,
  contact: HubSpotObject | undefined,
  props: readonly SignalProperty[]
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const p of props) {
    const raw = text(p.object === "deals" ? deal : contact, p.name);
    if (raw === null) continue;
    const value =
      p.kind === "bool"
        ? raw === "true" ? "Yes" : raw === "false" ? "No" : raw
        : p.options[raw] ?? raw;
    if (value) out[p.header] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

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
 * pipeline metadata came along and the id is kept when it did not - an
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
 * Seconds spent in each stage, from hs_time_in_<stageId>, which HubSpot keeps
 * in milliseconds. This is what the stage-trust check reads: a card dragged
 * through a stage in nine seconds was never in it, and without durations no
 * HubSpot stage could ever be caught doing that.
 */
export function stageDurationsOf(
  deal: HubSpotObject,
  stageLabels?: Map<string, string>
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [key] of Object.entries(deal.properties)) {
    const match = /^hs_time_in_(.+)$/.exec(key);
    if (!match) continue;
    const ms = number(deal, key);
    if (ms === null || ms < 0) continue;
    out[stageLabels?.get(match[1]) ?? match[1]] = Math.round(ms / 1000);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The properties a pull must request for stage timing to exist at all. */
export function stageTimingProperties(stageIds: Iterable<string>): string[] {
  const out: string[] = [];
  for (const id of stageIds) out.push(`hs_date_entered_${id}`, `hs_time_in_${id}`);
  return out;
}

/**
 * Which currencies this portal actually deals in, commonest first.
 *
 * Asked for before anything is priced, so a mixed portal can be given the same
 * treatment a mixed CSV gets - pick a reporting currency, set a rate, or leave
 * the minority out - rather than having its amounts quietly added together.
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

/**
 * A contact's fate, read from its deals first and HubSpot's own flags after.
 *
 * A deal is the stronger word: a contact whose deal closed won is a customer
 * whatever its lifecycle stage says. With no deal at all, "customer" on the
 * contact is a sale the portal records without a deal record (common in
 * consumer businesses that never open one), and "unqualified" or "bad
 * timing" is a lead that is gone. Anything else is still open, which is the
 * only reading that invents nothing.
 */
export function leadOutcomeOf(contact: HubSpotObject, deals: readonly HubSpotObject[]): DealOutcome {
  if (deals.length > 0) {
    const outcomes = deals.map(outcomeOf);
    if (outcomes.includes("won")) return "won";
    if (outcomes.includes("open")) return "open";
    return "lost";
  }
  const lifecycle = (text(contact, "lifecyclestage") ?? "").toLowerCase();
  if (lifecycle === "customer" || lifecycle === "evangelist") return "won";
  const status = (text(contact, "hs_lead_status") ?? "").toUpperCase();
  if (status === "UNQUALIFIED" || status === "BAD_TIMING") return "lost";
  return "open";
}

/**
 * Whether a contact is a lead at all.
 *
 * HubSpot files a newsletter signup as a "subscriber", and a form that
 * creates one is not a form an ad click was bought for. Everything else the
 * window created is a lead until its fate says otherwise.
 */
export function isLeadContact(contact: HubSpotObject): boolean {
  return (text(contact, "lifecyclestage") ?? "").toLowerCase() !== "subscriber";
}

function amountOf(deal: HubSpotObject, currency: CurrencyPolicy | null | undefined): number | null {
  const raw = number(deal, "amount");
  if (raw === null) return null;
  return convertAmount(raw, text(deal, "deal_currency_code"), currency);
}

function stageLabel(deal: HubSpotObject | undefined, pull: HubSpotPull): string | null {
  const stageId = text(deal, "dealstage");
  return stageId ? pull.stageLabels?.get(stageId) ?? stageId : null;
}

/** Newest first, so "the deal" for a lead with several is the latest one. */
function newestFirst(deals: readonly HubSpotObject[]): HubSpotObject[] {
  return [...deals].sort(
    (a, b) => (date(b, "createdate")?.getTime() ?? 0) - (date(a, "createdate")?.getTime() ?? 0)
  );
}

function dealToMapped(deal: HubSpotObject, pull: HubSpotPull, currency: CurrencyPolicy | null | undefined): MappedDeal {
  const contact = firstAssociated(deal, "contacts", pull.contactsById);
  const company = firstAssociated(deal, "companies", pull.companiesById);
  const createdAt = date(deal, "createdate");

  return {
    id: deal.id,
    createdAt,
    closedAt: date(deal, "closedate"),
    outcome: outcomeOf(deal),
    amount: amountOf(deal, currency),
    stage: stageLabel(deal, pull),
    // HubSpot's own attribution, not ours to infer.
    source: text(contact, "hs_analytics_source") ?? null,
    email: text(contact, "email"),
    clickId: clickIdOf(contact, pull.clickIdProperties ?? CLICK_ID_PROPERTIES),
    employeeCount: number(company, "numberofemployees"),
    industry: text(company, "industry"),
    contactTitle: text(contact, "jobtitle"),
    signals: signalsOf(deal, contact, pull.signalProperties ?? []),
    stageReachedAfterDays: stageTimingOf(deal, createdAt, pull.stageLabels),
    stageDurations: stageDurationsOf(deal, pull.stageLabels),
  };
}

/**
 * One lead per contact, carrying whatever its deals add.
 *
 * Day-0 is the contact's creation, because that is when the ad click became
 * a lead; a deal opened nine days later is a fact about the pipeline, not
 * about arrival. The amount is the sum of what its won deals were worth, the
 * stage and timing come off the newest deal, and the company comes off the
 * deal where there is one and off the contact's own link where there is not.
 */
function leadToMapped(
  contact: HubSpotObject,
  deals: readonly HubSpotObject[],
  pull: HubSpotPull,
  currency: CurrencyPolicy | null | undefined
): MappedDeal {
  const ordered = newestFirst(deals);
  const newest = ordered[0];
  const won = ordered.filter((d) => outcomeOf(d) === "won");
  const closed = ordered.filter((d) => outcomeOf(d) !== "open");
  const createdAt = date(contact, "createdate");

  const company =
    (newest && firstAssociated(newest, "companies", pull.companiesById)) ??
    pull.companiesById.get(text(contact, "associatedcompanyid") ?? "");

  let amount: number | null = null;
  for (const d of won) {
    const a = amountOf(d, currency);
    if (a !== null) amount = (amount ?? 0) + a;
  }

  const closedAt =
    (won.length > 0 ? won : closed)
      .map((d) => date(d, "closedate"))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return {
    id: `contact-${contact.id}`,
    createdAt,
    closedAt,
    outcome: leadOutcomeOf(contact, deals),
    amount,
    stage: stageLabel(newest, pull),
    source: text(contact, "hs_analytics_source") ?? null,
    email: text(contact, "email"),
    clickId: clickIdOf(contact, pull.clickIdProperties ?? CLICK_ID_PROPERTIES),
    employeeCount: number(company, "numberofemployees"),
    industry: text(company, "industry"),
    contactTitle: text(contact, "jobtitle"),
    signals: signalsOf(newest ?? { id: "", properties: {} }, contact, pull.signalProperties ?? []),
    stageReachedAfterDays: newest ? stageTimingOf(newest, createdAt, pull.stageLabels) : undefined,
    stageDurations: newest ? stageDurationsOf(newest, pull.stageLabels) : undefined,
  };
}

/**
 * The population the engine prices.
 *
 * Deals only, when the pull read deals only (`leads` absent): the shape this
 * always had. With the window's contacts read as well, every one of them is
 * a lead whether or not a deal followed, because a lead that never became a
 * deal is the commonest outcome in consumer lead generation and leaving it
 * out counts a close rate against the wrong denominator and never prices
 * the lead at all. A deal whose contacts all arrived before the window, or
 * that has none, is still emitted as a deal, so nothing that was counted
 * before is lost.
 */
export function hubspotToDeals(
  pull: HubSpotPull,
  currency?: CurrencyPolicy | null
): MappedDeal[] {
  const out: MappedDeal[] = [];
  const leads = pull.leads;
  if (!leads) {
    for (const deal of pull.deals) out.push(dealToMapped(deal, pull, currency));
    return out;
  }

  const leadIds = new Set(leads.map((c) => c.id));
  const dealsByContact = new Map<string, HubSpotObject[]>();
  for (const deal of pull.deals) {
    let claimed = false;
    for (const { id } of deal.associations?.contacts?.results ?? []) {
      if (!leadIds.has(id)) continue;
      claimed = true;
      const list = dealsByContact.get(id) ?? [];
      list.push(deal);
      dealsByContact.set(id, list);
      // One deal is one sale. It counts on its first lead, never on two.
      break;
    }
    if (!claimed) out.push(dealToMapped(deal, pull, currency));
  }

  for (const contact of leads) {
    const deals = dealsByContact.get(contact.id) ?? [];
    if (deals.length === 0 && !isLeadContact(contact)) continue;
    out.push(leadToMapped(contact, deals, pull, currency));
  }

  return out;
}

/** What the window held, for a screen to say rather than a caller to guess. */
export function populationOf(pull: HubSpotPull): {
  leads: number;
  dealsWithoutLead: number;
  subscribersSkipped: number;
} {
  const leads = pull.leads ?? [];
  const leadIds = new Set(leads.map((c) => c.id));
  const claimed = new Set<string>();
  for (const deal of pull.deals) {
    const owner = (deal.associations?.contacts?.results ?? []).find(({ id }) => leadIds.has(id));
    if (owner) claimed.add(owner.id);
  }
  return {
    leads: leads.filter((c) => claimed.has(c.id) || isLeadContact(c)).length,
    dealsWithoutLead: pull.deals.filter(
      (d) => !(d.associations?.contacts?.results ?? []).some(({ id }) => leadIds.has(id))
    ).length,
    subscribersSkipped: leads.filter((c) => !claimed.has(c.id) && !isLeadContact(c)).length,
  };
}
