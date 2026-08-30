import type { FeedRepository } from "./repository";

/**
 * Google fetches a scheduled upload once or twice a day, and the old limit of
 * 10 was set from that number alone. It was wrong, and it made the product
 * impossible to connect.
 *
 * Setting the connection up is not one fetch. Google's wizard reads the file to
 * list its columns, reads it again to map the fields, and validates it once
 * more on Finish. Go back a step, or start over after getting a mapping wrong,
 * and each pass costs several more. A first real attempt burned through 10
 * before Finish and came back as "The data source is inaccessible, not found or
 * not authorised" - because a 429 is indistinguishable from a dead URL from
 * Google's side, and the advertiser has no way to learn otherwise.
 *
 * So the budget has to cover a day of somebody learning the wizard, not just a
 * day of it running. 60 leaves room for several full setup attempts plus the
 * daily collection, and still refuses a token being polled around the clock.
 *
 * The limit was never what protects the contents anyway: every fetch returns
 * the same file, so the first one is the whole leak. What it protects is the
 * feed being used as free hosting, and how long a stolen token keeps paying
 * out. Revoking it is the real answer, and that is one click on the workspace
 * page.
 */
export const MAX_FETCHES_PER_DAY = 60;

/**
 * What one pass through Google's connection wizard costs, measured on a real
 * account: list the columns, map the fields, validate on Finish, with a couple
 * of spare for a step retried. The budget has to be a multiple of this, not of
 * the daily collection.
 */
export const SETUP_FETCH_COST = 5;
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
