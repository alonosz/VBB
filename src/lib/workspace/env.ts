import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { SupabaseWorkspaceRepository, type WorkspaceRepository } from "./repository";
import { SupabaseInviteStore, type InviteStore } from "./invite";

/** Null when Supabase is not configured, so callers say so rather than crash. */
export function workspaceRepositoryFromEnv(): WorkspaceRepository | null {
  const client = supabaseFromEnv();
  return client ? new SupabaseWorkspaceRepository(client) : null;
}

/** Same contract: null rather than a crash when the deployment has no database. */
export function inviteStoreFromEnv(): InviteStore | null {
  const client = supabaseFromEnv();
  return client ? new SupabaseInviteStore(client) : null;
}
