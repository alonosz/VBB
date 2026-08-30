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
}

const COLUMNS = "id, name, key_prefix, status, created_at";

function toWorkspace(dto: WorkspaceDto): Workspace {
  return {
    id: dto.id,
    name: dto.name,
    keyPrefix: dto.key_prefix,
    status: dto.status,
    createdAt: new Date(dto.created_at),
  };
}

export interface WorkspaceRepository {
  create(workspace: NewWorkspace): Promise<Workspace>;
  findByKey(key: string): Promise<Workspace | null>;
  findById(id: string): Promise<Workspace | null>;
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

export class SupabaseWorkspaceRepository implements WorkspaceRepository {
  constructor(private client: SupabaseClient) {}

  async create(workspace: NewWorkspace): Promise<Workspace> {
    const { data, error } = await this.client
      .from("workspaces")
      .insert({
        name: workspace.name,
        key_hash: workspace.keyHash,
        key_prefix: workspace.keyPrefix,
        created_ip_hash: workspace.createdIpHash ?? null,
      })
      .select(COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return toWorkspace(data as WorkspaceDto);
  }

  async findByKey(key: string): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from("workspaces")
      .select(COLUMNS)
      .eq("key_hash", await hashWorkspaceKey(key))
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? toWorkspace(data as WorkspaceDto) : null;
  }

  async findById(id: string): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from("workspaces")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? toWorkspace(data as WorkspaceDto) : null;
  }

  async list(): Promise<Workspace[]> {
    const { data, error } = await this.client
      .from("workspaces")
      .select(COLUMNS)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data as WorkspaceDto[]).map(toWorkspace);
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
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findByKey(key: string): Promise<Workspace | null> {
    const hash = await hashWorkspaceKey(key);
    const found = [...this.rows.values()].find((w) => w.keyHash === hash);
    return found ? { ...found } : null;
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
