import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { SupabaseWorkspaceRepository, type WorkspaceRepository } from "./repository";

/** Null when Supabase is not configured, so callers say so rather than crash. */
export function workspaceRepositoryFromEnv(): WorkspaceRepository | null {
  const client = supabaseFromEnv();
  return client ? new SupabaseWorkspaceRepository(client) : null;
}
