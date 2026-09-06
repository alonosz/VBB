import type { HubSpotObject, HubSpotPage, HubSpotPropertyDef, HubSpotPull } from "./types";
import {
  CLICK_ID_PROPERTIES,
  COMPANY_PROPERTIES,
  CONTACT_PROPERTIES,
  DEAL_PROPERTIES,
  MAX_SIGNAL_PROPERTIES,
  googleClickIdProperties,
  signalPropertiesOf,
  stageTimingProperties,
} from "./map";
import { HUBSPOT_HEADERS } from "./rows";

/**
 * Reading deals out of HubSpot.
 *
 * Scoped as narrowly as the job allows. It asks for a window of recent deals
 * rather than the portal, requests named properties rather than everything,
 * and reads - there is no write path here at all. A sync that could modify a
 * customer's CRM is a much larger promise than the one this product makes.
 *
 * fetch is injected so the pagination, batching and retry behaviour can be
 * tested against recorded shapes instead of a live portal.
 */

const API = "https://api.hubapi.com";

/**
 * How far back a run looks.
 *
 * A conversion can only be adjusted inside Google's 7 days, and a new one only
 * needs sending once, so a month is comfortably more than enough while keeping
 * a nightly run small. Anything older is history the next refit will read, not
 * something a run can act on.
 */
export const DEFAULT_WINDOW_DAYS = 30;

/** HubSpot's own maximum for these endpoints. */
const PAGE_SIZE = 100;
const BATCH_SIZE = 100;

/** A runaway pull is a bug, not a big portal. 100 pages is 10,000 deals. */
const MAX_PAGES = 100;

export interface HubSpotClientOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: Date;
  windowDays?: number;
  /** Injected so retry backoff does not make tests slow. */
  sleep?: (ms: number) => Promise<void>;
}

export class HubSpotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HubSpotError";
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class HubSpotClient {
  private fetchImpl: typeof fetch;
  private baseUrl: string;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: HubSpotClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? API;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async request<T>(path: string, body: unknown, attempt = 0): Promise<T> {
    // A null body means GET. Everything else about the call - the retry on
    // 429, the reconnect message on 401 - has to behave identically, so both
    // verbs go through here rather than growing a second copy.
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: body === null ? "GET" : "POST",
      headers: {
        // Never logged. The token is the whole credential for someone's CRM.
        authorization: `Bearer ${this.opts.accessToken}`,
        "content-type": "application/json",
      },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });

    if (res.status === 429 || res.status >= 500) {
      // HubSpot rate-limits per portal, and a nightly run is not urgent, so
      // waiting is always better than dropping a day of leads.
      if (attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2 ** attempt * 1000;
        await this.sleep(wait);
        return this.request<T>(path, body, attempt + 1);
      }
      throw new HubSpotError(
        `HubSpot is not responding (${res.status}). Nothing was published; the next run will pick these up.`,
        res.status
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new HubSpotError(
        "HubSpot refused the connection. Reconnect the account to grant access again.",
        res.status
      );
    }

    if (!res.ok) {
      throw new HubSpotError(`HubSpot returned ${res.status}.`, res.status);
    }

    return (await res.json()) as T;
  }

  /**
   * What contact properties this portal has.
   *
   * Read so the click ID can be found by what it is rather than by what we
   * guessed someone would call it. Cheap - one request, no paging in practice
   * - and the alternative is a connection that silently carries no click IDs.
   */
  async listContactProperties(): Promise<HubSpotPropertyDef[]> {
    return this.listProperties("contacts");
  }

  /**
   * Every property definition the portal has for one object: name, label,
   * type, and the options behind a dropdown. This is how the pull learns
   * what the advertiser's own fields are called and which of them are
   * categories worth pricing on.
   */
  async listProperties(object: "deals" | "contacts"): Promise<HubSpotPropertyDef[]> {
    const res = await this.request<{ results?: Partial<HubSpotPropertyDef>[] }>(
      `/crm/v3/properties/${object}`,
      null
    );
    return (res.results ?? []).filter(
      (p): p is HubSpotPropertyDef => typeof p.name === "string"
    );
  }

  /**
   * Stage id -> label, across every deal pipeline.
   *
   * Stage ids are opaque ("123456", "appointmentscheduled"), and the
   * hs_date_entered_ and hs_time_in_ properties are named by id. Without this
   * the report would call a stage by its id and could not ask for its timing
   * at all.
   */
  async listPipelineStages(): Promise<Map<string, string>> {
    const res = await this.request<{
      results?: { stages?: { id?: string; label?: string }[] }[];
    }>("/crm/v3/pipelines/deals", null);
    const out = new Map<string, string>();
    for (const pipeline of res.results ?? []) {
      for (const stage of pipeline.stages ?? []) {
        if (typeof stage.id === "string" && typeof stage.label === "string") {
          out.set(stage.id, stage.label);
        }
      }
    }
    return out;
  }

  /**
   * Deals created inside the window, newest pages first as HubSpot orders them.
   *
   * @param extraProperties The portal's own signal properties and the
   *   per-stage timing properties, discovered before this is called. The
   *   search endpoint returns only what is asked for.
   */
  async listRecentDeals(extraProperties: readonly string[] = []): Promise<HubSpotObject[]> {
    const now = this.opts.now ?? new Date();
    const windowDays = this.opts.windowDays ?? DEFAULT_WINDOW_DAYS;
    const since = now.getTime() - windowDays * 86_400_000;

    const deals: HubSpotObject[] = [];
    let after: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        filterGroups: [
          { filters: [{ propertyName: "createdate", operator: "GTE", value: String(since) }] },
        ],
        properties: [...new Set([...DEAL_PROPERTIES, ...extraProperties])],
        limit: PAGE_SIZE,
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
      };
      if (after) body.after = after;

      const result = await this.request<HubSpotPage>("/crm/v3/objects/deals/search", body);
      deals.push(...(result.results ?? []));

      after = result.paging?.next?.after;
      if (!after) return deals;
    }

    // Hitting the cap means the window is wider than a nightly run should be.
    // Returning what we have beats failing, and the count makes it visible.
    return deals;
  }

  /**
   * Which contacts and companies a set of deals points at.
   *
   * The search endpoint returns properties but not associations, so this is a
   * separate call rather than something that rides along with the deal. One
   * batch per object type, not one call per deal.
   *
   * NOTE: the exact response shape here is the part of this client least
   * verified against a live portal - it is written to HubSpot's documented v4
   * batch-associations shape, and reads defensively so an unexpected payload
   * yields no associations rather than a crash. Worth confirming against a
   * real account before trusting a first run's numbers.
   */
  async readAssociations(
    kind: "contacts" | "companies",
    dealIds: string[]
  ): Promise<Map<string, string[]>> {
    const byDeal = new Map<string, string[]>();
    const unique = [...new Set(dealIds)];

    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const chunk = unique.slice(i, i + BATCH_SIZE);
      const result = await this.request<{
        results?: { from?: { id?: string }; to?: { toObjectId?: string | number }[] }[];
      }>(`/crm/v4/associations/deals/${kind}/batch/read`, {
        inputs: chunk.map((id) => ({ id })),
      });

      for (const row of result.results ?? []) {
        const from = row.from?.id;
        if (!from) continue;
        const ids = (row.to ?? [])
          .map((t) => (t.toObjectId === undefined ? null : String(t.toObjectId)))
          .filter((id): id is string => !!id);
        if (ids.length > 0) byDeal.set(from, ids);
      }
    }

    return byDeal;
  }

  /**
   * The cheapest possible read of one object type, used only to prove a token
   * can see it. One record, no properties.
   */
  async probe(kind: "deals" | "contacts" | "companies"): Promise<void> {
    await this.request(`/crm/v3/objects/${kind}/search`, { limit: 1, properties: [] });
  }

  /** Batch-reads the records a set of deals points at. */
  async readBatch(
    kind: "contacts" | "companies",
    ids: string[],
    properties: string[]
  ): Promise<Map<string, HubSpotObject>> {
    const byId = new Map<string, HubSpotObject>();
    const unique = [...new Set(ids)];

    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const chunk = unique.slice(i, i + BATCH_SIZE);
      const result = await this.request<{ results?: HubSpotObject[] }>(
        `/crm/v3/objects/${kind}/batch/read`,
        { properties, inputs: chunk.map((id) => ({ id })) }
      );
      for (const record of result.results ?? []) byId.set(record.id, record);
    }

    return byId;
  }
}

/**
 * Confirms a token works and can see what the model needs, at the moment it is
 * pasted rather than at six in the morning.
 *
 * A private app with the wrong scopes ticked fails on the first real run
 * otherwise, and by then nobody is watching. One cheap read against each
 * object type turns that into an error the advertiser sees while they still
 * have the scopes screen open.
 */
export async function verifyAccess(
  client: HubSpotClient
): Promise<{ ok: true } | { ok: false; error: string }> {
  // All three, not just deals: the model needs the email and click ID from the
  // contact and the size and industry from the company, so a token missing
  // either scope produces leads priced on nothing.
  for (const kind of ["deals", "contacts", "companies"] as const) {
    try {
      await client.probe(kind);
    } catch (error) {
      if (error instanceof HubSpotError && (error.status === 401 || error.status === 403)) {
        return {
          ok: false,
          error: `That token cannot read ${kind}. Check it was copied whole, and that the private app has the deals, contacts and companies read scopes.`,
        };
      }
      return {
        ok: false,
        error: "We couldn't reach HubSpot with that token. Try again in a moment.",
      };
    }
  }

  return { ok: true };
}

/**
 * Everything a run needs, in as few calls as HubSpot allows.
 *
 * The associations come back on the deal search, so contacts and companies are
 * read in batches by id rather than one request per deal - a portal with a
 * thousand recent deals is 10 deal pages and 20 batch reads, not 2,000 calls.
 */
export async function pullFromHubSpot(client: HubSpotClient): Promise<HubSpotPull> {
  /*
   * What the portal calls things, before a single deal is read. The search
   * endpoint returns only the properties named in the request, so the
   * advertiser's own dropdowns and the per-stage timing have to be known in
   * advance to be asked for at all. None of these reads is worth losing the
   * run over: a portal whose token cannot see property definitions still
   * gets its deals priced on the standard fields, the way it always was.
   */
  const [stageLabels, dealDefs, contactDefs] = await Promise.all([
    client.listPipelineStages().catch(() => new Map<string, string>()),
    client.listProperties("deals").catch(() => [] as HubSpotPropertyDef[]),
    client.listContactProperties().catch(() => [] as HubSpotPropertyDef[]),
  ]);

  // Signal headers must never collide with the fixed columns, or a portal
  // with a property labelled "Industry" would overwrite the mapped one.
  const taken = new Set<string>(Object.values(HUBSPOT_HEADERS));
  const dealSignals = signalPropertiesOf(dealDefs, "deals", taken);
  const contactSignals = signalPropertiesOf(
    contactDefs,
    "contacts",
    taken,
    MAX_SIGNAL_PROPERTIES - dealSignals.length
  );
  const signalProperties = [...dealSignals, ...contactSignals];

  const deals = await client.listRecentDeals([
    ...dealSignals.map((s) => s.name),
    ...stageTimingProperties(stageLabels.keys()),
  ]);
  if (deals.length === 0) {
    return { deals, contactsById: new Map(), companiesById: new Map(), stageLabels, signalProperties };
  }

  const dealIds = deals.map((d) => d.id);

  // Search gives properties but not associations, so they are read separately
  // and attached here. A deal that already carried them keeps what it had.
  const [contactLinks, companyLinks] = await Promise.all([
    client.readAssociations("contacts", dealIds),
    client.readAssociations("companies", dealIds),
  ]);

  for (const deal of deals) {
    const contacts = contactLinks.get(deal.id);
    const companies = companyLinks.get(deal.id);
    if (!contacts && !companies) continue;
    deal.associations = {
      contacts: deal.associations?.contacts ??
        (contacts ? { results: contacts.map((id) => ({ id })) } : undefined),
      companies: deal.associations?.companies ??
        (companies ? { results: companies.map((id) => ({ id })) } : undefined),
    };
  }

  // Where the portal keeps the click ID, read off the same property list, so
  // the batch request includes it. With no definitions the known names stand.
  let clickIdProperties = [...CLICK_ID_PROPERTIES];
  const discovered = googleClickIdProperties(contactDefs);
  if (discovered.length > 0) clickIdProperties = discovered;

  const contactProperties = [
    ...new Set([
      ...CONTACT_PROPERTIES,
      ...clickIdProperties,
      ...contactSignals.map((s) => s.name),
    ]),
  ];

  const contactIds = [...contactLinks.values()].flat();
  const companyIds = [...companyLinks.values()].flat();

  const [contactsById, companiesById] = await Promise.all([
    contactIds.length > 0
      ? client.readBatch("contacts", contactIds, contactProperties)
      : Promise.resolve(new Map<string, HubSpotObject>()),
    companyIds.length > 0
      ? client.readBatch("companies", companyIds, COMPANY_PROPERTIES)
      : Promise.resolve(new Map<string, HubSpotObject>()),
  ]);

  return { deals, contactsById, companiesById, clickIdProperties, stageLabels, signalProperties };
}
