import type { SupabaseClient } from "@supabase/supabase-js";
import { hashWorkspaceKey } from "./key";

/**
 * Workspaces, and the lookup every authorised route starts with.
 *
 * There is deliberately no "find by name" and no "list all" reachable from a
 * request: an operator lists workspaces with the service role from a script,
 * and a customer only ever resolves the one workspace their key opens. A
 * product with five customers does not need a directory, and not having one
 * removes a whole category of way to see someone else's.
 */

export type WorkspaceStatus = "active" | "suspended";

export interface Workspace {
  id: string;
  name: string;
  keyPrefix: string;
  status: WorkspaceStatus;
  createdAt: Date;
  /**
   * When they moved their campaigns to a value-based bid strategy, and the
   * dividing line for the before/after comparison. Null means they have not
   * switched, or have not told us - the screen says which rather than
   * guessing. It is the one part of that comparison nobody can reconstruct
   * afterwards, which is why it is recorded the day it happens.
   */
  valueBiddingSwitchedAt: Date | null;
  /**
   * Where to send the link that opens this workspace on another device. A
   * self-serve workspace has no name anyone typed, so this is also how the
   * operator tells them apart. Null until the advertiser leaves one.
   */
  contactEmail: string | null;
  /**
   * When the key was last presented and accepted. The one thing the admin
   * list needs that creation date cannot tell it: whether anyone came back.
   * Null until they do.
   */
  lastSeenAt: Date | null;
}

export interface NewWorkspace {
  name: string;
  keyHash: string;
  keyPrefix: string;
  /**
   * Salted hash of whoever asked, set only when a visitor minted this
   * workspace themselves. Null for the ones an operator made at /admin, which
   * need no limiting because creating one already required the admin password.
   */
  createdIpHash?: string | null;
}

interface WorkspaceDto {
  id: string;
  name: string;
  key_prefix: string;
  status: WorkspaceStatus;
  created_at: string;
  value_bidding_switched_at: string | null;
  contact_email?: string | null;
  last_seen_at?: string | null;
}

const COLUMNS =
  "id, name, key_prefix, status, created_at, value_bidding_switched_at, contact_email, last_seen_at";

/**
 * The same list before the last-seen migration. Migrations here are pasted
 * into the SQL Editor by hand, so a deploy can land before its column does.
 * Reading must keep working in that window rather than refuse every key in
 * the product until somebody notices; the repository falls back to this
 * list on the first "column does not exist" and says so in the log.
 */
const COLUMNS_BEFORE_LAST_SEEN =
  "id, name, key_prefix, status, created_at, value_bidding_switched_at, contact_email";

/** PostgREST's "undefined column", as Postgres reports it. */
export function isMissingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  return error.code === "42703" || (error.message ?? "").includes(column);
}

/**
 * How often a busy session is allowed to write its own timestamp. A page that
 * makes a dozen calls a minute would otherwise cost a dozen updates for a
 * fact that only needs to be right to the quarter hour.
 */
export const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

function toWorkspace(dto: WorkspaceDto): Workspace {
  return {
    id: dto.id,
    name: dto.name,
    keyPrefix: dto.key_prefix,
    status: dto.status,
    createdAt: new Date(dto.created_at),
    valueBiddingSwitchedAt: dto.value_bidding_switched_at
      ? new Date(dto.value_bidding_switched_at)
      : null,
    contactEmail: dto.contact_email ?? null,
    lastSeenAt: dto.last_seen_at ? new Date(dto.last_seen_at) : null,
  };
}

export interface WorkspaceRepository {
  create(workspace: NewWorkspace): Promise<Workspace>;
  findByKey(key: string): Promise<Workspace | null>;
  findById(id: string): Promise<Workspace | null>;
  /** The newest workspace carrying this address, for signing in by it. */
  findByContactEmail(email: string): Promise<Workspace | null>;
  /** Operator-only, used by the console script rather than any route. */
  list(): Promise<Workspace[]>;
  suspend(id: string): Promise<void>;
  /**
   * Replace the key on an existing workspace.
   *
   * Redeeming an invite mints a fresh key rather than handing back a stored
   * one, which is what lets the key live only as a hash. The previous key
   * stops working here - correct for the case this exists to serve, where the
   * customer has just said they no longer have it.
   */
  rotateKey(id: string, keyHash: string, keyPrefix: string): Promise<void>;

  /** Records, or clears, the day they switched to value-based bidding. */
  setSwitchedAt(id: string, at: Date | null): Promise<void>;
  /** The address the advertiser left, replacing any earlier one. */
  setContactEmail(id: string, email: string): Promise<void>;
  /** What the workspace is called, once its owner has said. */
  setName(id: string, name: string): Promise<void>;
  /**
   * Note that the key was just used. Best effort and throttled: a failure
   * here must never refuse a request, and a burst of calls writes once.
   */
  touch(id: string, at: Date): Promise<void>;
  /**
   * How many workspaces this caller has minted since `since`.
   *
   * Counting the rows *is* the rate limit, the same shape the feed fetch log
   * uses: one fact rather than a counter that can drift from the thing it is
   * supposed to describe. Zero for an unknown caller, so a proxy that strips
   * the header cannot lock everyone out on one stranger's behalf.
   */
  countCreatedSince(ipHash: string | null, since: Date): Promise<number>;
}

/**
 * What a PostgREST call resolves to, typed loosely on purpose: the column
 * list is a runtime value here, so the client cannot infer the row shape.
 */
type Reply = { data: unknown; error: { code?: string; message: string } | null };

export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  private columns = COLUMNS;

  constructor(private client: SupabaseClient) {}

  /**
   * Run a read, and if the only thing wrong is that the newest column has
   * not been added yet, run it again without that column and remember.
   */
  private async read<T>(query: (columns: string) => PromiseLike<Reply>): Promise<T | null> {
    let reply = await query(this.columns);
    if (reply.error && this.columns === COLUMNS && isMissingColumn(reply.error, "last_seen_at")) {
      console.warn(
        "workspaces.last_seen_at does not exist yet: run supabase/migrations/20260916100000_workspace_last_seen.sql. Reading without it until then."
      );
      this.columns = COLUMNS_BEFORE_LAST_SEEN;
      reply = await query(this.columns);
    }
    if (reply.error) throw new Error(reply.error.message);
    return reply.data as T | null;
  }

  async create(workspace: NewWorkspace): Promise<Workspace> {
    const data = await this.read<WorkspaceDto>((columns) =>
      this.client
        .from("workspaces")
        .insert({
          name: workspace.name,
          key_hash: workspace.keyHash,
          key_prefix: workspace.keyPrefix,
          created_ip_hash: workspace.createdIpHash ?? null,
        })
        .select(columns)
        .single()
    );
    if (!data) throw new Error("The workspace was not created.");
    return toWorkspace(data);
  }

  async findByKey(key: string): Promise<Workspace | null> {
    const hash = await hashWorkspaceKey(key);
    const data = await this.read<WorkspaceDto>((columns) =>
      this.client.from("workspaces").select(columns).eq("key_hash", hash).maybeSingle()
    );
    return data ? toWorkspace(data) : null;
  }

  async findByContactEmail(email: string): Promise<Workspace | null> {
    const data = await this.read<WorkspaceDto>((columns) =>
      this.client
        .from("workspaces")
        .select(columns)
        .eq("contact_email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );
    return data ? toWorkspace(data) : null;
  }

  async findById(id: string): Promise<Workspace | null> {
    const data = await this.read<WorkspaceDto>((columns) =>
      this.client.from("workspaces").select(columns).eq("id", id).maybeSingle()
    );
    return data ? toWorkspace(data) : null;
  }

  async list(): Promise<Workspace[]> {
    const data = await this.read<WorkspaceDto[]>((columns) =>
      this.client.from("workspaces").select(columns).order("created_at", { ascending: false })
    );
    return (data ?? []).map(toWorkspace);
  }

  async suspend(id: string): Promise<void> {
    const { error } = await this.client
      .from("workspaces")
      .update({ status: "suspended", suspended_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async rotateKey(id: string, keyHash: string, keyPrefix: string): Promise<void> {
    const { error } = await this.client
      .from("workspaces")
      .update({ key_hash: keyHash, key_prefix: keyPrefix })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async setSwitchedAt(id: string, at: Date | null): Promise<void> {
    const { error } = await this.client
      .from("workspaces")
      .update({ value_bidding_switched_at: at ? at.toISOString() : null })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async setContactEmail(id: string, email: string): Promise<void> {
    const { error } = await this.client
      .from("workspaces")
      .update({ contact_email: email })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  async setName(id: string, name: string): Promise<void> {
    const { error } = await this.client.from("workspaces").update({ name }).eq("id", id);
    if (error) throw new Error(error.message);
  }

  async touch(id: string, at: Date): Promise<void> {
    const cutoff = new Date(at.getTime() - LAST_SEEN_THROTTLE_MS).toISOString();
    const { error } = await this.client
      .from("workspaces")
      .update({ last_seen_at: at.toISOString() })
      .eq("id", id)
      .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff}`);
    if (error) throw new Error(error.message);
  }

  async countCreatedSince(ipHash: string | null, since: Date): Promise<number> {
    if (!ipHash) return 0;

    const { count, error } = await this.client
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .eq("created_ip_hash", ipHash)
      .gte("created_at", since.toISOString());

    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}

// ---------------------------------------------------------------------------
// In-memory, for tests
// ---------------------------------------------------------------------------

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private rows = new Map<string, Workspace & { keyHash: string; createdIpHash: string | null }>();
  private seq = 0;

  constructor(private now: () => Date = () => new Date()) {}

  async create(workspace: NewWorkspace): Promise<Workspace> {
    if ([...this.rows.values()].some((w) => w.keyHash === workspace.keyHash)) {
      throw new Error("That key is already in use.");
    }
    const row = {
      id: `ws-${++this.seq}`,
      name: workspace.name,
      keyPrefix: workspace.keyPrefix,
      keyHash: workspace.keyHash,
      createdIpHash: workspace.createdIpHash ?? null,
      status: "active" as const,
      createdAt: this.now(),
      valueBiddingSwitchedAt: null as Date | null,
      contactEmail: null as string | null,
      lastSeenAt: null as Date | null,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findByKey(key: string): Promise<Workspace | null> {
    const hash = await hashWorkspaceKey(key);
    const found = [...this.rows.values()].find((w) => w.keyHash === hash);
    return found ? { ...found } : null;
  }

  async findByContactEmail(email: string): Promise<Workspace | null> {
    const matches = [...this.rows.values()]
      .filter((r) => r.contactEmail === email)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ? { ...matches[0] } : null;
  }

  async findById(id: string): Promise<Workspace | null> {
    const found = this.rows.get(id);
    return found ? { ...found } : null;
  }

  async list(): Promise<Workspace[]> {
    return [...this.rows.values()].map((w) => ({ ...w }));
  }

  async suspend(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.status = "suspended";
  }

  async setSwitchedAt(id: string, at: Date | null): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.valueBiddingSwitchedAt = at;
  }

  async setContactEmail(id: string, email: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.contactEmail = email;
  }

  async setName(id: string, name: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.name = name;
  }

  async touch(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    if (row.lastSeenAt && at.getTime() - row.lastSeenAt.getTime() < LAST_SEEN_THROTTLE_MS) return;
    row.lastSeenAt = at;
  }

  async rotateKey(id: string, keyHash: string, keyPrefix: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.keyHash = keyHash;
    row.keyPrefix = keyPrefix;
  }

  async countCreatedSince(ipHash: string | null, since: Date): Promise<number> {
    if (!ipHash) return 0;
    return [...this.rows.values()].filter(
      (w) => w.createdIpHash === ipHash && w.createdAt >= since
    ).length;
  }
}
