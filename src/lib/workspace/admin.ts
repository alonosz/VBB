import { timingSafeEqual } from "node:crypto";

/**
 * The operator's own credential.
 *
 * Everything else in this product deliberately requires nothing to be
 * remembered: workspace keys live in the customer's browser, feed tokens live
 * in Google Ads, and the encryption key is set once and never read again.
 *
 * This one is different, and it is the exception on purpose. Creating a
 * customer is the act that brings a workspace into existence, so it cannot be
 * authorised by a workspace key - there is not one yet. Something has to
 * establish that the person asking is the operator, and the smallest honest
 * answer is a password they choose and keep.
 *
 * Without it set, the admin page is closed rather than open. A setup screen
 * that anyone can reach is worse than one nobody can.
 */

/** Long enough that guessing is not a strategy. */
export const MIN_ADMIN_KEY_LENGTH = 16;

export function adminKeyFromEnv(): string | null {
  const key = process.env.VBB_ADMIN_KEY?.trim();
  if (!key || key.length < MIN_ADMIN_KEY_LENGTH) return null;
  return key;
}

/**
 * Constant-time, so the comparison cannot be used to discover the key one
 * character at a time.
 */
export function adminKeyMatches(presented: unknown, expected: string): boolean {
  if (typeof presented !== "string") return false;
  const a = Buffer.from(presented.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
