import {
  assertStorableRow,
  type FeedRecord,
  type FeedRow,
  type FetchLogEntry,
  type NewFeed,
} from "./types";

/**
 * How the feed reaches storage.
 *
 * An interface rather than direct Supabase calls, because the rules that
 * matter — the rate limit, the emit window, the CSV shape — are worth testing
 * without a database in the loop, and because the endpoint should not care
 * which one it is talking to.
 */
export interface FeedRepository {
  createFeed(feed: NewFeed): Promise<FeedRecord>;
  findByTokenHash(tokenHash: string): Promise<FeedRecord | null>;
  /** Inserts rows, ignoring any that were already sent. Returns how many were new. */
  addRows(feedId: string, rows: FeedRow[]): Promise<number>;
  rowsFor(feedId: string): Promise<FeedRow[]>;
  countFetchesSince(feedId: string, since: Date): Promise<number>;
  logFetch(feedId: string, entry: FetchLogEntry): Promise<void>;
  revokeFeed(feedId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory — used by the tests, and by nothing else
// ---------------------------------------------------------------------------

export class InMemoryFeedRepository implements FeedRepository {
  private feeds = new Map<string, FeedRecord & { tokenHash: string }>();
  private rows = new Map<string, FeedRow[]>();
  private fetches = new Map<string, Date[]>();
  /** Exposed so tests can assert what was logged, not just how much. */
  readonly log: { feedId: string; entry: FetchLogEntry; at: Date }[] = [];

  constructor(private now: () => Date = () => new Date()) {}

  async createFeed(feed: NewFeed): Promise<FeedRecord> {
    if ([...this.feeds.values()].some((f) => f.tokenHash === feed.tokenHash)) {
      throw new Error("That token is already in use.");
    }
    const record: FeedRecord & { tokenHash: string } = {
      id: `feed-${this.feeds.size + 1}`,
      tokenHash: feed.tokenHash,
      tokenPrefix: feed.tokenPrefix,
      label: feed.label ?? null,
      modelId: feed.modelId,
      modelFittedAt: feed.modelFittedAt ?? null,
      currencyCode: feed.currencyCode,
      identifier: feed.identifier,
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

  async addRows(feedId: string, incoming: FeedRow[]): Promise<number> {
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

  async countFetchesSince(feedId: string, since: Date): Promise<number> {
    return (this.fetches.get(feedId) ?? []).filter((d) => d > since).length;
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
}
