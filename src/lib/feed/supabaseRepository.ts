import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LoadResult, SavedValueModel } from "@/lib/model/savedModel";
import { loadSavedModel } from "@/lib/model/savedModel";
import {
  assertStorableModel,
  assertStorableRow,
  type FeedRecord,
  type FeedIdentifier,
  type FeedRow,
  type FeedRowKind,
  type FetchLogEntry,
  type FetchRecord,
  type NewFeed,
} from "./types";
import type { FeedRepository } from "./repository";

/**
 * The Supabase implementation.
 *
 * Uses the service-role key, so it must only ever be constructed on the
 * server. Row-level security is on with no policies, which means this is the
 * only way in — there is deliberately no browser path to these tables.
 */

interface FeedRowDto {
  hashed_email: string | null;
  click_id: string | null;
  conversion_time: string;
  value: string | number;
  currency_code: string;
  model_id: string;
  kind: FeedRowKind;
  row_key: string;
}

interface FeedDto {
  id: string;
  client_id: string;
  token_prefix: string;
  label: string | null;
  model_id: string;
  model_fitted_at: string | null;
  currency_code: string;
  identifier: FeedIdentifier;
  status: "active" | "revoked";
  created_at: string;
  published_at: string | null;
  rows_published: number;
}

function toRecord(dto: FeedDto): FeedRecord {
  return {
    id: dto.id,
    clientId: dto.client_id,
    tokenPrefix: dto.token_prefix,
    label: dto.label,
    modelId: dto.model_id,
    modelFittedAt: dto.model_fitted_at ? new Date(dto.model_fitted_at) : null,
    currencyCode: dto.currency_code,
    identifier: dto.identifier,
    status: dto.status,
    createdAt: new Date(dto.created_at),
    publishedAt: dto.published_at ? new Date(dto.published_at) : null,
    rowsPublished: dto.rows_published,
  };
}

const FEED_COLUMNS =
  "id, client_id, token_prefix, label, model_id, model_fitted_at, currency_code, identifier, status, created_at, published_at, rows_published";

export class SupabaseFeedRepository implements FeedRepository {
  constructor(private client: SupabaseClient) {}

  async createFeed(feed: NewFeed): Promise<FeedRecord> {
    const { data, error } = await this.client
      .from("feeds")
      .insert({
        client_id: feed.clientId,
        token_hash: feed.tokenHash,
        token_prefix: feed.tokenPrefix,
        label: feed.label ?? null,
        model_id: feed.modelId,
        model_fitted_at: feed.modelFittedAt?.toISOString() ?? null,
        currency_code: feed.currencyCode,
        identifier: feed.identifier,
      })
      .select(FEED_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return toRecord(data as FeedDto);
  }

  async findByTokenHash(tokenHash: string): Promise<FeedRecord | null> {
    const { data, error } = await this.client
      .from("feeds")
      .select(FEED_COLUMNS)
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? toRecord(data as FeedDto) : null;
  }

  async findById(feedId: string): Promise<FeedRecord | null> {
    const { data, error } = await this.client
      .from("feeds")
      .select(FEED_COLUMNS)
      .eq("id", feedId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? toRecord(data as FeedDto) : null;
  }

  async listForWorkspace(clientId: string): Promise<FeedRecord[]> {
    const { data, error } = await this.client
      .from("feeds")
      .select(FEED_COLUMNS)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data as FeedDto[]).map(toRecord);
  }

  async addRows(feedId: string, rows: FeedRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    for (const row of rows) assertStorableRow(row);

    // Republishing must not resend a conversion Google already has, so a
    // collision on the unique key is the expected case, not an error.
    const { data, error } = await this.client
      .from("feed_rows")
      .upsert(
        rows.map((r) => ({
          feed_id: feedId,
          hashed_email: r.hashedEmail,
          click_id: r.clickId,
          conversion_time: r.conversionTime.toISOString(),
          value: r.value,
          currency_code: r.currencyCode,
          model_id: r.modelId,
          kind: r.kind,
          row_key: r.rowKey,
        })),
        { onConflict: "feed_id,row_key,kind", ignoreDuplicates: true }
      )
      .select("id");

    if (error) throw new Error(error.message);
    const added = data?.length ?? 0;

    const { count } = await this.client
      .from("feed_rows")
      .select("id", { count: "exact", head: true })
      .eq("feed_id", feedId);

    await this.client
      .from("feeds")
      .update({ rows_published: count ?? 0, published_at: new Date().toISOString() })
      .eq("id", feedId);

    return added;
  }

  async rowsFor(feedId: string): Promise<FeedRow[]> {
    const { data, error } = await this.client
      .from("feed_rows")
      .select("hashed_email, click_id, conversion_time, value, currency_code, model_id, kind, row_key")
      .eq("feed_id", feedId)
      .order("conversion_time", { ascending: true });

    if (error) throw new Error(error.message);
    return (data as FeedRowDto[]).map((r) => ({
      hashedEmail: r.hashed_email,
      clickId: r.click_id,
      conversionTime: new Date(r.conversion_time),
      value: Number(r.value),
      currencyCode: r.currency_code,
      modelId: r.model_id,
      kind: r.kind,
      rowKey: r.row_key,
    }));
  }

  async saveModel(feedId: string, model: SavedValueModel): Promise<void> {
    // Checked here as well as in Postgres so the failure names the cause. The
    // constraint would refuse it either way, but "violates check constraint
    // feed_models_carries_no_addresses" is not something to show anyone.
    assertStorableModel(model);

    const { error } = await this.client.from("feed_models").upsert(
      {
        feed_id: feedId,
        model_id: model.modelId,
        format_version: model.formatVersion,
        fitted_at: model.fittedAt,
        currency_code: model.currencyCode,
        model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "feed_id" }
    );

    if (error) throw new Error(error.message);
  }

  async modelFor(feedId: string): Promise<LoadResult> {
    const { data, error } = await this.client
      .from("feed_models")
      .select("model")
      .eq("feed_id", feedId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { model: null, error: "This feed has no saved model." };
    return loadSavedModel((data as { model: unknown }).model);
  }

  async countFetchesSince(feedId: string, since: Date): Promise<number> {
    const { count, error } = await this.client
      .from("feed_fetches")
      .select("id", { count: "exact", head: true })
      .eq("feed_id", feedId)
      .gt("fetched_at", since.toISOString());

    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async recentFetches(feedId: string, limit: number): Promise<FetchRecord[]> {
    const { data, error } = await this.client
      .from("feed_fetches")
      .select("fetched_at, status, row_count, user_agent")
      .eq("feed_id", feedId)
      .order("fetched_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as { fetched_at: string; status: number; row_count: number; user_agent: string | null }[]).map(
      (r) => ({
        fetchedAt: new Date(r.fetched_at),
        status: r.status,
        rowCount: r.row_count,
        userAgent: r.user_agent,
      })
    );
  }

  async logFetch(feedId: string, entry: FetchLogEntry): Promise<void> {
    // A failure to log must not turn a good fetch into a bad one, but it does
    // need to be visible in the server logs rather than swallowed.
    const { error } = await this.client.from("feed_fetches").insert({
      feed_id: feedId,
      status: entry.status,
      row_count: entry.rowCount,
      user_agent: entry.userAgent,
      ip_hash: entry.ipHash,
    });
    if (error) console.error("feed fetch log failed:", error.message);
  }

  async rotateToken(feedId: string, tokenHash: string, tokenPrefix: string): Promise<void> {
    const { error } = await this.client
      .from("feeds")
      .update({ token_hash: tokenHash, token_prefix: tokenPrefix })
      .eq("id", feedId);
    if (error) throw new Error(error.message);
  }

  async revokeFeed(feedId: string): Promise<void> {
    const { error } = await this.client
      .from("feeds")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", feedId);
    if (error) throw new Error(error.message);
  }
}

/**
 * Returns null when Supabase is not configured, so every caller has to decide
 * what to say about that rather than crashing on a missing key.
 *
 * Supabase renamed its privileged key from `service_role` to a "secret key"
 * (`sb_secret_…`); both are the same thing to us, and a project may have been
 * set up under either name. Accepting both means nobody has to rename an
 * environment variable to match a dashboard that changed after they read the
 * instructions.
 */
export function feedRepositoryFromEnv(): FeedRepository | null {
  const client = supabaseFromEnv();
  return client ? new SupabaseFeedRepository(client) : null;
}

/**
 * The raw client, for the tables that are not the feed's own — the CRM
 * connection store reaches Supabase directly rather than through a repository
 * shaped around feeds.
 */
export function supabaseFromEnv(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;

  // The publishable key is the easy one to grab by mistake — it sits directly
  // above the secret key in the dashboard. It would fail on every single query
  // against tables with row-level security and no policies, which reads as
  // "the database is broken" rather than "wrong key". Say which it is.
  if (isPublishableKey(key)) {
    console.error(
      "Supabase is configured with a publishable key. That key cannot read the " +
        "feed tables, because row-level security is on with no policies. Use the " +
        "secret key (sb_secret_…), and keep it out of any NEXT_PUBLIC_ variable."
    );
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

/** The publishable (formerly anon) key, under either naming. */
export function isPublishableKey(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  // Legacy anon keys are JWTs carrying their role in the payload.
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64").toString()).role === "anon";
  } catch {
    return false;
  }
}
