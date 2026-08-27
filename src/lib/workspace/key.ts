import { sha256Hex } from "@/lib/export/googleAds";

/**
 * Workspace keys.
 *
 * The product now has two credentials, and keeping them apart is the point.
 *
 * A feed token is handed to Google. It reads one CSV and can do nothing else.
 * A workspace key never leaves the advertiser: it authorises publishing,
 * connecting a CRM, and reading status. Before this split, the feed token did
 * both jobs, which meant anyone holding a URL that lives in a Google Ads
 * configuration screen could attach their own HubSpot to someone else's feed.
 *
 * Same construction as the feed token — 256 bits, stored only as a hash — so
 * the security properties are the ones already tested, and the prefix is
 * visibly different so nobody pastes one where the other belongs.
 */

const KEY_BYTES = 32;
export const WORKSPACE_KEY_PREFIX = "vbb_ws_";

export interface GeneratedWorkspaceKey {
  /** Shown once, then unrecoverable. */
  key: string;
  keyHash: string;
  /** Enough to recognise the workspace in a list, too little to use it. */
  keyPrefix: string;
}

function toBase62(bytes: Uint8Array): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (const b of bytes) out += alphabet[b % 62];
  return out;
}

export async function generateWorkspaceKey(): Promise<GeneratedWorkspaceKey> {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  const key = WORKSPACE_KEY_PREFIX + toBase62(bytes);
  return {
    key,
    keyHash: await sha256Hex(key),
    keyPrefix: key.slice(0, WORKSPACE_KEY_PREFIX.length + 4),
  };
}

export async function hashWorkspaceKey(key: string): Promise<string> {
  return sha256Hex(key.trim());
}

/**
 * Whether a pasted string is even shaped like a workspace key.
 *
 * Checked before hashing so a pasted paragraph never becomes a database query,
 * and so the commonest mistake — pasting the feed URL here — gets told what it
 * is rather than a flat "not found".
 */
export function looksLikeWorkspaceKey(input: string): boolean {
  return new RegExp(`^${WORKSPACE_KEY_PREFIX}[A-Za-z0-9]{16,64}$`).test(input.trim());
}

/** The mistake worth naming, because both credentials are in the same email. */
export function looksLikeFeedToken(input: string): boolean {
  return /^vbb_live_/.test(input.trim()) || /\/v1\/feeds\//.test(input);
}
