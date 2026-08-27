import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypting the credentials that reach someone else's CRM.
 *
 * The feed tables hold hashed identifiers and values — a leak of those is bad.
 * A HubSpot refresh token is a different order of thing: it is standing read
 * access to a customer's entire CRM, and row-level security only protects it
 * while the database itself is not the thing that leaked.
 *
 * So tokens are encrypted before they are stored, with a key that lives in the
 * environment and never in the database. A dump of the tables on its own is
 * then useless.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than silently yielding a different token. A fresh random IV per encryption,
 * because reusing one under the same key in GCM is catastrophic rather than
 * merely untidy.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = "v1";

export class MissingKeyError extends Error {
  constructor() {
    super(
      "CRM connections are not configured on this deployment: VBB_TOKEN_KEY is not set. " +
        "Nothing was stored — a credential for someone's CRM is not written down in the clear."
    );
    this.name = "MissingKeyError";
  }
}

/**
 * Accepts the key as base64 or hex, because the two are easy to confuse when
 * pasting one into a hosting dashboard and the failure would otherwise be a
 * baffling length error.
 */
export function parseKey(raw: string | undefined): Buffer | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === KEY_BYTES) return decoded;
  } catch {
    // fall through
  }
  return null;
}

export function keyFromEnv(): Buffer | null {
  return parseKey(process.env.VBB_TOKEN_KEY);
}

/** Encrypted form: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new MissingKeyError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null rather than throwing on anything malformed or tampered with.
 *
 * A caller that cannot decrypt a token has exactly one correct response — ask
 * the advertiser to reconnect — and that is the same response whether the key
 * rotated, the row was corrupted, or someone edited the ciphertext. Making it
 * an exception would only invite a catch that treats those differently.
 */
export function decryptSecret(encoded: string, key: Buffer): string | null {
  if (key.length !== KEY_BYTES) return null;

  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** For generating a key to paste into a hosting dashboard. */
export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
