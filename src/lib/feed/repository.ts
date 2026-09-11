import type { LoadResult, SavedValueModel } from "@/lib/model/savedModel";
import { loadSavedModel } from "@/lib/model/savedModel";
import {
  assertStorableModel,
  assertStorableRow,
  type FeedRecord,
  type FeedRow,
  type FetchLogEntry,
  type FetchRecord,
  type NewFeed,
} from "./types";

/**
 * How the feed reaches storage.
 *
 * An interface rather than direct Supabase calls, because the rules that
 * matter - the rate limit, the emit window, the CSV shape - are worth testing
 * without a database in the loop, and because the endpoint should not care
 * which one it is talking to.
 */
export interface FeedRepository {
  createFeed(feed: NewFeed): Promise<FeedRecord>;
  findByTokenHash(tokenHash: string): Promise<FeedRecord | null>;
  /** By id, for a scheduled run that already knows which feed it is servicing. */
  findById(feedId: string): Promise<FeedRecord | null>;
  /** Everything one customer owns, newest first. */
  listForWorkspace(clientId: string): Promise<FeedRecord[]>;
  /** Inserts rows, ignoring any that were already sent. Returns how many were new. */
  /**
   * Adds what is not already there. `deliveredAt` writes the rows as already
   * at Google in the same insert, for a send the browser just made: two
   * writes would leave a window where a run resends the lot.
   */
  addRows(feedId: string, rows: FeedRow[], opts?: { deliveredAt?: Date }): Promise<number>;
  rowsFor(feedId: string): Promise<FeedRow[]>;
  /**
   * The rows for a few named leads, by identifier. What a partial run needs
   * to know whether a lead was already sent, without reading a year of
   * history to find out.
   */
  rowsForIdentifiers(feedId: string, ids: { clickIds: string[]; hashedEmails: string[] }): Promise<FeedRow[]>;
  /**
   * Rows of an API-delivered feed that have not reached Google. Every row
   * starts here; a successful send marks it delivered. A URL feed's rows are
   * never marked, because Google fetches those itself and tells nobody.
   * A row Google refused on its own is left out unless `retryFailed`, so
   * the live path does not spend every webhook on it and the nightly run
   * still tries it once a day.
   */
  pendingRows(feedId: string, opts?: { retryFailed?: boolean }): Promise<FeedRow[]>;
  /** How many rows are waiting, refused ones included. A count, never the rows. */
  countPending(feedId: string): Promise<number>;
  /** Google accepted these. Identified by (rowKey, kind), the row's identity. */
  markDelivered(feedId: string, rows: Pick<FeedRow, "rowKey" | "kind">[], at: Date): Promise<void>;
  /** Google refused these on their own, and said why. */
  markFailed(feedId: string, rows: Pick<FeedRow, "rowKey" | "kind">[], error: string, at: Date): Promise<void>;
  /**
   * Freezes the model that priced this feed's rows, so a scheduled run can
   * apply it with no browser in the loop. Republishing after a refit replaces
   * it - the rows already sent keep the model_id that priced them.
   */
  saveModel(feedId: string, model: SavedValueModel): Promise<void>;
  /**
   * Reads it back through loadSavedModel(), because a row in our own database
   * is not more trustworthy than a file someone uploaded. Returns the same
   * {model, error} shape so a caller has to face a broken model rather than
   * pricing leads at zero.
   */
  modelFor(feedId: string): Promise<LoadResult>;
  countFetchesSince(feedId: string, since: Date): Promise<number>;
  /** Most recent fetches, newest first - what the advertiser is shown. */
  recentFetches(feedId: string, limit: number): Promise<FetchRecord[]>;
  logFetch(feedId: string, entry: FetchLogEntry): Promise<void>;
  revokeFeed(feedId: string): Promise<void>;
  /**
   * Issues a new token for an existing feed, keeping its rows, model and
   * history. Used when a customer has lost the URL - the alternative is
   * republishing, which loses the record of what Google already has and would
   * resend every conversion.
   */
  rotateToken(feedId: string, tokenHash: string, tokenPrefix: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory - used by the tests, and by nothing else
// ---------------------------------------------------------------------------

export class InMemoryFeedRepository implements FeedRepository {
  private feeds = new Map<string, FeedRecord & { tokenHash: string }>();
  private rows = new Map<string, FeedRow[]>();
  /** Keyed feedId|rowKey|kind, the row's identity. */
  private delivered = new Map<string, Date>();
  private failed = new Map<string, { at: Date; error: string }>();
  private fetches = new Map<string, Date[]>();
  private models = new Map<string, string>();
  /** Exposed so tests can assert what was logged, not just how much. */
  readonly log: { feedId: string; entry: FetchLogEntry; at: Date }[] = [];

  constructor(private now: () => Date = () => new Date()) {}

  async createFeed(feed: NewFeed): Promise<FeedRecord> {
    if ([...this.feeds.values()].some((f) => f.tokenHash === feed.tokenHash)) {
      throw new Error("That token is already in use.");
    }
    const record: FeedRecord & { tokenHash: string } = {
      id: `feed-${this.feeds.size + 1}`,
      clientId: feed.clientId,
      tokenHash: feed.tokenHash,
      tokenPrefix: feed.tokenPrefix,
      label: feed.label ?? null,
      modelId: feed.modelId,
      modelFittedAt: feed.modelFittedAt ?? null,
      currencyCode: feed.currencyCode,
      identifier: feed.identifier,
      delivery: feed.delivery ?? "url",
      status: "active",
      createdAt: this.now(),
      publishedAt: null,
      rowsPublished: 0,
    };
    this.feeds.set(record.id, record);
    this.rows.set(record.id, []);
    return { ...record };
  }

  async findByTokenHash(tokenHash: string): Promise<FeedRecord | null> {
    const found = [...this.feeds.values()].find((f) => f.tokenHash === tokenHash);
    return found ? { ...found } : null;
  }

  async findById(feedId: string): Promise<FeedRecord | null> {
    const found = this.feeds.get(feedId);
    return found ? { ...found } : null;
  }

  async listForWorkspace(clientId: string): Promise<FeedRecord[]> {
    return [...this.feeds.values()]
      .filter((f) => f.clientId === clientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((f) => ({ ...f }));
  }

  async addRows(feedId: string, incoming: FeedRow[], opts: { deliveredAt?: Date } = {}): Promise<number> {
    const feed = this.feeds.get(feedId);
    if (!feed) throw new Error("No such feed.");
    const existing = this.rows.get(feedId) ?? [];
    let added = 0;

    for (const row of incoming) {
      // The same guard the database applies, so a test can never pass on a row
      // Postgres would refuse.
      assertStorableRow(row);
      const duplicate = existing.some((r) => r.rowKey === row.rowKey && r.kind === row.kind);
      if (duplicate) continue;
      existing.push({ ...row });
      if (opts.deliveredAt) this.delivered.set(`${feedId}|${row.rowKey}|${row.kind}`, opts.deliveredAt);
      added++;
    }

    this.rows.set(feedId, existing);
    feed.rowsPublished = existing.length;
    feed.publishedAt = this.now();
    return added;
  }

  async rowsFor(feedId: string): Promise<FeedRow[]> {
    return (this.rows.get(feedId) ?? []).map((r) => ({ ...r }));
  }

  async rowsForIdentifiers(
    feedId: string,
    ids: { clickIds: string[]; hashedEmails: string[] }
  ): Promise<FeedRow[]> {
    const clicks = new Set(ids.clickIds);
    const emails = new Set(ids.hashedEmails);
    return (this.rows.get(feedId) ?? [])
      .filter((r) => (r.clickId && clicks.has(r.clickId)) || (r.hashedEmail && emails.has(r.hashedEmail)))
      .map((r) => ({ ...r }));
  }

  async pendingRows(feedId: string, opts: { retryFailed?: boolean } = {}): Promise<FeedRow[]> {
    return (this.rows.get(feedId) ?? [])
      .filter((r) => {
        const key = `${feedId}|${r.rowKey}|${r.kind}`;
        if (this.delivered.has(key)) return false;
        return opts.retryFailed || !this.failed.has(key);
      })
      .map((r) => ({ ...r }));
  }

  async countPending(feedId: string): Promise<number> {
    return (await this.pendingRows(feedId, { retryFailed: true })).length;
  }

  async markDelivered(feedId: string, rows: Pick<FeedRow, "rowKey" | "kind">[], at: Date): Promise<void> {
    for (const r of rows) {
      const key = `${feedId}|${r.rowKey}|${r.kind}`;
      this.delivered.set(key, at);
      this.failed.delete(key);
    }
  }

  async markFailed(feedId: string, rows: Pick<FeedRow, "rowKey" | "kind">[], error: string, at: Date): Promise<void> {
    for (const r of rows) this.failed.set(`${feedId}|${r.rowKey}|${r.kind}`, { at, error });
  }

  /** Why a row is stuck, for a test to assert. */
  failureOf(feedId: string, rowKey: string, kind: FeedRow["kind"] = "conversion"): string | null {
    return this.failed.get(`${feedId}|${rowKey}|${kind}`)?.error ?? null;
  }

  /** When a row reached Google, for a test to assert. Null if it has not. */
  deliveredAt(feedId: string, rowKey: string, kind: FeedRow["kind"] = "conversion"): Date | null {
    return this.delivered.get(`${feedId}|${rowKey}|${kind}`) ?? null;
  }

  async saveModel(feedId: string, model: SavedValueModel): Promise<void> {
    if (!this.feeds.has(feedId)) throw new Error("No such feed.");
    // The same guard the database applies.
    assertStorableModel(model);
    this.models.set(feedId, JSON.stringify(model));
  }

  async modelFor(feedId: string): Promise<LoadResult> {
    const raw = this.models.get(feedId);
    if (!raw) return { model: null, error: "This feed has no saved model." };
    return loadSavedModel(JSON.parse(raw));
  }

  async countFetchesSince(feedId: string, since: Date): Promise<number> {
    return (this.fetches.get(feedId) ?? []).filter((d) => d > since).length;
  }

  async recentFetches(feedId: string, limit: number): Promise<FetchRecord[]> {
    return this.log
      .filter((l) => l.feedId === feedId)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit)
      .map((l) => ({
        fetchedAt: l.at,
        status: l.entry.status,
        rowCount: l.entry.rowCount,
        userAgent: l.entry.userAgent,
      }));
  }

  async logFetch(feedId: string, entry: FetchLogEntry): Promise<void> {
    const at = this.now();
    const all = this.fetches.get(feedId) ?? [];
    all.push(at);
    this.fetches.set(feedId, all);
    this.log.push({ feedId, entry, at });
  }

  async revokeFeed(feedId: string): Promise<void> {
    const feed = this.feeds.get(feedId);
    if (feed) feed.status = "revoked";
  }

  async rotateToken(feedId: string, tokenHash: string, tokenPrefix: string): Promise<void> {
    const feed = this.feeds.get(feedId);
    if (!feed) throw new Error("No such feed.");
    if ([...this.feeds.values()].some((f) => f.id !== feedId && f.tokenHash === tokenHash)) {
      throw new Error("That token is already in use.");
    }
    feed.tokenHash = tokenHash;
    feed.tokenPrefix = tokenPrefix;
  }
}
