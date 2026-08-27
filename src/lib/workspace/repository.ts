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
}

// ---------------------------------------------------------------------------
// In-memory, for tests
// ---------------------------------------------------------------------------

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private rows = new Map<string, Workspace & { keyHash: string }>();
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
}
