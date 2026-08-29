import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret, keyFromEnv, MissingKeyError } from "./secrets";

/**
 * Where a CRM connection is kept.
 *
 * Keyed on the workspace, not on a feed. A feed does not exist until a model
 * has been published, and the analysis wants to read a CRM well before that —
 * connecting HubSpot at step 2 replaces the CSV export, which is the easiest
 * thing in this product for a human to get wrong. One customer, one portal,
 * read by whatever needs it.
 *
 * Tokens are encrypted on the way in and decrypted on the way out, so no
 * caller ever has the option of writing one down in the clear — the database
 * would refuse it anyway, but the refusal should never be reached.
 *
 * A connection that cannot be decrypted is reported as needing reconnection
 * rather than as an error. From the advertiser's side those are the same
 * event, whatever caused it: the key rotated, the row was corrupted, the
 * portal was disconnected. All of them mean "connect it again".
 */

export type SyncStatus = "ok" | "refused" | "failed";

export interface CrmConnection {
  workspaceId: string;
  provider: "hubspot";
  externalAccountId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncError: string | null;
  lastSyncRows: number | null;
}

export interface NewCrmConnection {
  workspaceId: string;
  provider: "hubspot";
  externalAccountId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string | null;
}

export interface ConnectionLoad {
  connection: CrmConnection | null;
  /** Plain-English, shown to the advertiser. Null on success. */
  error: string | null;
}

/** An error message is for a person, and must never carry CRM data. */
const MAX_ERROR = 500;

interface ConnectionDto {
  workspace_id: string;
  provider: "hubspot";
  external_account_id: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string | null;
  last_sync_at: string | null;
  last_sync_status: SyncStatus | null;
  last_sync_error: string | null;
  last_sync_rows: number | null;
}

const COLUMNS =
  "workspace_id, provider, external_account_id, access_token, refresh_token, expires_at, scopes, last_sync_at, last_sync_status, last_sync_error, last_sync_rows";

export class CrmConnectionStore {
  constructor(
    private client: SupabaseClient,
    private key: Buffer | null = keyFromEnv()
  ) {}

  get configured(): boolean {
    return this.key !== null;
  }

  async save(connection: NewCrmConnection): Promise<void> {
    if (!this.key) throw new MissingKeyError();

    const { error } = await this.client.from("crm_connections").upsert(
      {
        workspace_id: connection.workspaceId,
        provider: connection.provider,
        external_account_id: connection.externalAccountId ?? null,
        access_token: encryptSecret(connection.accessToken, this.key),
        refresh_token: connection.refreshToken
          ? encryptSecret(connection.refreshToken, this.key)
          : null,
        expires_at: connection.expiresAt?.toISOString() ?? null,
        scopes: connection.scopes ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

    if (error) throw new Error(error.message);
  }

  async load(workspaceId: string): Promise<ConnectionLoad> {
    if (!this.key) {
      return { connection: null, error: new MissingKeyError().message };
    }

    const { data, error } = await this.client
      .from("crm_connections")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return { connection: null, error: "This feed has no CRM connected." };

    const dto = data as ConnectionDto;
    const accessToken = decryptSecret(dto.access_token, this.key);
    if (accessToken === null) {
      return {
        connection: null,
        error: "The stored CRM credentials could not be read. Reconnect the account.",
      };
    }

    const refreshToken = dto.refresh_token ? decryptSecret(dto.refresh_token, this.key) : null;

    return {
      connection: {
        workspaceId: dto.workspace_id,
        provider: dto.provider,
        externalAccountId: dto.external_account_id,
        accessToken,
        refreshToken,
        expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
        scopes: dto.scopes,
        lastSyncAt: dto.last_sync_at ? new Date(dto.last_sync_at) : null,
        lastSyncStatus: dto.last_sync_status,
        lastSyncError: dto.last_sync_error,
        lastSyncRows: dto.last_sync_rows,
      },
      error: null,
    };
  }

  /** What happened on the last run, so a connection that stopped working shows. */
  async recordRun(
    workspaceId: string,
    outcome: { status: SyncStatus; rows?: number; error?: string | null; at?: Date }
  ): Promise<void> {
    const { error } = await this.client
      .from("crm_connections")
      .update({
        last_sync_at: (outcome.at ?? new Date()).toISOString(),
        last_sync_status: outcome.status,
        last_sync_rows: outcome.rows ?? 0,
        last_sync_error: outcome.error ? outcome.error.slice(0, MAX_ERROR) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId);

    // A failure to record the outcome must not turn a good run into a bad one,
    // but it does need to be visible rather than swallowed.
    if (error) console.error("recording a sync outcome failed:", error.message);
  }

  async disconnect(workspaceId: string): Promise<void> {
    const { error } = await this.client.from("crm_connections").delete().eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
  }

  /** All feeds with a connection, for the scheduled run to walk. */
  async connectedWorkspaceIds(): Promise<string[]> {
    const { data, error } = await this.client.from("crm_connections").select("workspace_id");
    if (error) throw new Error(error.message);
    return (data as { workspace_id: string }[]).map((r) => r.workspace_id);
  }
}
