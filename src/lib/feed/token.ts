import { sha256Hex } from "@/lib/export/googleAds";

/**
 * Feed tokens.
 *
 * The token is the whole credential — anyone holding the URL can fetch the
 * feed — so it is generated with 256 bits of entropy and stored only as a
 * hash. We can therefore never show it again after the moment it is created,
 * which is worth saying plainly in the UI rather than papering over.
 */

const TOKEN_BYTES = 32;
export const TOKEN_PREFIX = "vbb_live_";

export interface GeneratedToken {
  /** Shown once, then unrecoverable. */
  token: string;
  tokenHash: string;
  /** Enough to recognise the feed in a list, too little to use it. */
  tokenPrefix: string;
}

function toBase62(bytes: Uint8Array): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (const b of bytes) out += alphabet[b % 62];
  return out;
}

export async function generateFeedToken(): Promise<GeneratedToken> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = TOKEN_PREFIX + toBase62(bytes);
  return {
    token,
    tokenHash: await sha256Hex(token),
    tokenPrefix: token.slice(0, TOKEN_PREFIX.length + 4),
  };
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token.trim());
}

/** Hashes a caller IP for the fetch log. Salted so the log is not a rainbow table. */
export async function hashIp(ip: string | null, salt: string): Promise<string | null> {
  if (!ip?.trim()) return null;
  return sha256Hex(`${salt}:${ip.trim()}`);
}

/**
 * Pulls the token out of whatever the advertiser pasted.
 *
 * They will paste the whole feed URL, because that is the thing they were
 * given and told to keep. Accepting a bare token too costs nothing and saves
 * anyone who kept only the key.
 *
 * Deliberately forgiving about surrounding whitespace and a trailing slash,
 * and deliberately strict about the token itself: anything that is not a
 * plausible token is rejected here rather than sent to be hashed and looked
 * up, so a pasted paragraph cannot become a database query.
 */
export function tokenFromInput(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let path: string;
    try {
      path = new URL(trimmed).pathname;
    } catch {
      return null;
    }
    candidate = path.split("/").pop() ?? "";
  }

  candidate = candidate.replace(/\.csv$/i, "").replace(/\.tsv$/i, "");
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(candidate)) return null;
  return candidate;
}
