import type { FeedRepository } from "./repository";

/**
 * Google fetches a scheduled upload once or twice a day. Anything much beyond
 * that is either a misconfiguration or someone who found the URL, so the limit
 * is set well above normal use and low enough that a leaked token cannot be
 * mined continuously.
 */
export const MAX_FETCHES_PER_DAY = 10;
export const RATE_WINDOW_MS = 86_400_000;

export interface RateVerdict {
  allowed: boolean;
  used: number;
  limit: number;
  /** Seconds until the window frees up, for the Retry-After header. */
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  repo: FeedRepository,
  feedId: string,
  now: Date
): Promise<RateVerdict> {
  const used = await repo.countFetchesSince(feedId, new Date(now.getTime() - RATE_WINDOW_MS));
  return {
    allowed: used < MAX_FETCHES_PER_DAY,
    used,
    limit: MAX_FETCHES_PER_DAY,
    // Without per-fetch timestamps to hand, the honest answer is "within the
    // window" rather than a precise wait we cannot compute here.
    retryAfterSeconds: Math.ceil(RATE_WINDOW_MS / 1000 / MAX_FETCHES_PER_DAY),
  };
}
