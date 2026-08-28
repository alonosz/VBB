import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/export/googleAds";

/**
 * One-time links.
 *
 * The customer used to be handed a `vbb_ws_` key and asked to paste it. That
 * put a live credential through the operator's email and left no way back if
 * it was lost — the only recovery was a new workspace, which orphans the feed
 * and the saved model it was attached to.
 *
 * An invite is a link the operator sends instead. Clicking it mints the key
 * directly in the customer's browser, so the credential never exists anywhere
 * else. Nothing stored here can be used: the token is kept as a hash, and the
 * workspace key it produces is not stored at all — redeeming generates a fresh
 * one and replaces the hash on the workspace row.
 *
 * That makes "send them a new link" and "rotate their key" the same operation,
 * which is exactly right for a customer who has just said they lost theirs.
 */

const TOKEN_BYTES = 32;
export const INVITE_PREFIX = "vbb_inv_";

/** Long enough to send and act on, short enough not to be a spare password. */
export const INVITE_TTL_HOURS = 72;

export interface GeneratedInvite {
  /** Goes in the link. Shown once; only a hash is kept. */
  token: string;
  tokenHash: string;
}

function toBase62(bytes: Uint8Array): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (const b of bytes) out += alphabet[b % 62];
  return out;
}

export async function generateInviteToken(): Promise<GeneratedInvite> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = INVITE_PREFIX + toBase62(bytes);
  return { token, tokenHash: await sha256Hex(token) };
}

export async function hashInviteToken(token: string): Promise<string> {
  return sha256Hex(token.trim());
}

/**
 * Whether a string is even shaped like an invite token.
 *
 * Checked before hashing so a truncated link — the commonest failure, because
 * mail clients wrap long URLs — is told what it is rather than reported as
 * "not found".
 */
export function looksLikeInviteToken(input: string): boolean {
  return new RegExp(`^${INVITE_PREFIX}[A-Za-z0-9]{16,64}$`).test(input.trim());
}

export interface Invite {
  id: string;
  workspaceId: string;
  createdAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
}

export interface InviteStore {
  create(workspaceId: string, tokenHash: string, expiresAt: Date): Promise<Invite>;
  /**
   * Spend the invite matching this hash, or return null.
   *
   * Marking it spent is the same statement that finds it, so two clicks on the
   * same link cannot both mint a key. Expiry is part of that condition rather
   * than a check afterwards, for the same reason.
   */
  redeem(tokenHash: string, now: Date): Promise<Invite | null>;
}

interface InviteDto {
  id: string;
  workspace_id: string;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
}

const COLUMNS = "id, workspace_id, created_at, expires_at, redeemed_at";

function toInvite(dto: InviteDto): Invite {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    createdAt: new Date(dto.created_at),
    expiresAt: new Date(dto.expires_at),
    redeemedAt: dto.redeemed_at ? new Date(dto.redeemed_at) : null,
  };
}

export class SupabaseInviteStore implements InviteStore {
  constructor(private client: SupabaseClient) {}

  async create(workspaceId: string, tokenHash: string, expiresAt: Date): Promise<Invite> {
    const { data, error } = await this.client
      .from("workspace_invites")
      .insert({
        workspace_id: workspaceId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      })
      .select(COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return toInvite(data as InviteDto);
  }

  async redeem(tokenHash: string, now: Date): Promise<Invite | null> {
    // One statement: find it unspent and unexpired, and spend it. Postgres
    // takes the row lock, so a second click updates nothing and gets null.
    const { data, error } = await this.client
      .from("workspace_invites")
      .update({ redeemed_at: now.toISOString() })
      .eq("token_hash", tokenHash)
      .is("redeemed_at", null)
      .gt("expires_at", now.toISOString())
      .select(COLUMNS)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ? toInvite(data as InviteDto) : null;
  }
}

// ---------------------------------------------------------------------------
// In-memory, for tests
// ---------------------------------------------------------------------------

export class InMemoryInviteStore implements InviteStore {
  private rows = new Map<string, Invite & { tokenHash: string }>();
  private seq = 0;

  async create(workspaceId: string, tokenHash: string, expiresAt: Date): Promise<Invite> {
    const row = {
      id: `inv-${++this.seq}`,
      workspaceId,
      tokenHash,
      createdAt: new Date(),
      expiresAt,
      redeemedAt: null as Date | null,
    };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async redeem(tokenHash: string, now: Date): Promise<Invite | null> {
    const row = [...this.rows.values()].find(
      (r) => r.tokenHash === tokenHash && r.redeemedAt === null && r.expiresAt > now
    );
    if (!row) return null;
    row.redeemedAt = now;
    return { ...row };
  }
}
