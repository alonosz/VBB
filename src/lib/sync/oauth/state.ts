import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed state parameter, shared by every provider we hand a browser to.
 *
 * There are no user accounts in this product, so nothing about the browser
 * that comes back from a provider proves it is the same one that left. The
 * workspace key is the only credential in play and it must not travel through
 * someone else's redirect, where it would land in their logs and the visitor's
 * history.
 *
 * So the state carries the workspace *id* and a timestamp, signed with a key
 * only this server holds. The callback trusts the signature rather than the
 * browser: unsigned, edited or stale is refused, which is what stops somebody
 * attaching their own portal or ads account to another advertiser's workspace.
 *
 * One implementation, because two would eventually disagree and the one that
 * drifted would be the one nobody was looking at.
 */

/** A connect link is for finishing now, not for keeping. */
export const STATE_TTL_MS = 15 * 60 * 1000;

/** Tolerance for a signer whose clock runs slightly ahead of ours. */
const CLOCK_SKEW_MS = 60_000;

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** `subject` is whatever the callback needs back: a workspace id, a feed id. */
export function signState(subject: string, key: Buffer, now: Date = new Date()): string {
  const payload = `${subject}.${now.getTime()}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload, key)}`;
}

/** Returns the subject, or null for anything unsigned, edited or expired. */
export function verifyState(state: string, key: Buffer, now: Date = new Date()): string | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;

  let payload: string;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(parts[1]);
  // Constant-time, so the comparison cannot be used to discover a valid
  // signature one byte at a time.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const split = payload.lastIndexOf(".");
  if (split <= 0) return null;
  const subject = payload.slice(0, split);
  const issued = Number(payload.slice(split + 1));
  if (!Number.isFinite(issued)) return null;
  if (now.getTime() - issued > STATE_TTL_MS) return null;
  if (issued - now.getTime() > CLOCK_SKEW_MS) return null; // skew, not the future

  return subject || null;
}
