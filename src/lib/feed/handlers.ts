import type { SavedValueModel } from "@/lib/model/savedModel";
import { loadSavedModel } from "@/lib/model/savedModel";
import { buildFeedCsv } from "./csv";
import { checkRateLimit } from "./rateLimit";
import type { FeedRepository } from "./repository";
import { generateFeedToken, hashIp, hashToken } from "./token";
import { assertStorableRow, type FeedIdentifier, type FeedRow } from "./types";

/**
 * The request handling, separated from how the repository is obtained.
 *
 * The routes are thin wrappers that resolve Supabase from the environment;
 * everything worth getting right - token authorization, the rate limit, what a
 * failed fetch reveals, what the CSV contains - lives here where it can be
 * driven end to end against an in-memory repository in tests.
 */

export const CONVERSION_NAME = "VBB Lead Value";
const MAX_ROWS = 200_000;

export interface HandlerResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

const TEXT = { "content-type": "text/plain; charset=utf-8" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/**
 * The same answer for a token that never existed, one that was revoked, and a
 * request with no token at all. Distinguishing them would confirm to a prober
 * that a token was once real.
 */
function notFound(): HandlerResponse {
  return { status: 404, body: "Not found\n", headers: TEXT };
}

// ---------------------------------------------------------------------------
// Serving the feed
// ---------------------------------------------------------------------------

export interface ServeContext {
  token: string | null;
  userAgent: string | null;
  ip: string | null;
  now?: Date;
}

export async function serveFeed(
  repo: FeedRepository,
  ctx: ServeContext
): Promise<HandlerResponse> {
  if (!ctx.token?.trim()) return notFound();

  const feed = await repo.findByTokenHash(await hashToken(ctx.token));
  if (!feed || feed.status !== "active") return notFound();

  const now = ctx.now ?? new Date();
  const ipHash = await hashIp(ctx.ip, feed.id);

  const rate = await checkRateLimit(repo, feed.id, now);
  if (!rate.allowed) {
    await repo.logFetch(feed.id, {
      status: 429,
      rowCount: 0,
      userAgent: ctx.userAgent,
      ipHash,
    });
    return {
      status: 429,
      body: `This feed has been fetched ${rate.used} times in the last 24 hours, above its limit of ${rate.limit}.\n`,
      headers: { ...TEXT, "retry-after": String(rate.retryAfterSeconds) },
    };
  }

  const rows = await repo.rowsFor(feed.id);
  const csv = buildFeedCsv(rows, feed.identifier, CONVERSION_NAME);

  await repo.logFetch(feed.id, {
    status: 200,
    rowCount: rows.length,
    userAgent: ctx.userAgent,
    ipHash,
  });

  return {
    status: 200,
    body: csv,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="vbb-google-ads.csv"',
      // Google should see what was published, not what was published last time.
      "cache-control": "no-store",
      "x-vbb-rows": String(rows.length),
      "x-vbb-model": feed.modelId,
    },
  };
}

// ---------------------------------------------------------------------------
// Publishing a feed
// ---------------------------------------------------------------------------

export interface PublishBody {
  modelId?: unknown;
  modelFittedAt?: unknown;
  currencyCode?: unknown;
  identifier?: unknown;
  label?: unknown;
  rows?: unknown;
  /**
   * The saved model that priced these rows. Optional, because a one-off
   * publish is complete without it - the rows are what Google fetches. It is
   * what a later scheduled run needs in order to price new leads the same way,
   * so a feed published without one can be fetched but never refreshed on its
   * own.
   */
  model?: unknown;
  /** Authorises the publish. Read by the route, never by the handler. */
  workspaceKey?: unknown;
}

function bad(message: string, status = 400): HandlerResponse {
  return { status, body: JSON.stringify({ ok: false, error: message }), headers: JSON_HEADERS };
}

/**
 * Rows arrive from a browser, so they are untrusted like any other input.
 * Anything the database's CHECK constraints would refuse is refused here first,
 * with something a person can read.
 */
export function parseRows(raw: unknown, currencyCode: string, modelId: string): FeedRow[] {
  if (!Array.isArray(raw)) throw new Error("No rows were sent.");
  if (raw.length > MAX_ROWS) {
    throw new Error(`A feed takes at most ${MAX_ROWS.toLocaleString()} rows.`);
  }

  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") throw new Error(`Row ${i + 1} is not a row.`);
    const e = entry as Record<string, unknown>;

    const row: FeedRow = {
      hashedEmail: typeof e.hashedEmail === "string" ? e.hashedEmail : null,
      clickId: typeof e.clickId === "string" ? e.clickId : null,
      conversionTime: new Date(String(e.conversionTime)),
      value: Number(e.value),
      // The feed's own currency and model win over anything a row claims, so
      // one feed can never mix units or mix models.
      currencyCode,
      modelId,
      kind: e.kind === "adjustment" ? "adjustment" : "conversion",
      rowKey: typeof e.rowKey === "string" ? e.rowKey : "",
    };

    if (!row.rowKey) throw new Error(`Row ${i + 1} has no identity.`);
    try {
      assertStorableRow(row);
    } catch (error) {
      throw new Error(`Row ${i + 1}: ${(error as Error).message}`);
    }
    return row;
  });
}

export async function publishFeed(
  repo: FeedRepository,
  body: PublishBody,
  origin: string,
  /** The workspace that authorised this publish. Every feed has an owner. */
  clientId: string
): Promise<HandlerResponse> {
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const currencyCode = typeof body.currencyCode === "string" ? body.currencyCode.trim() : "";
  const identifier: FeedIdentifier = body.identifier === "email" ? "email" : "clickId";

  if (!modelId) return bad("A feed has to say which model priced it.");
  if (!/^[A-Z]{3}$/.test(currencyCode)) return bad("A feed needs an ISO currency code.");

  // Validated before anything is created, so a malformed model fails the
  // request outright instead of leaving a feed that can never refresh itself.
  let model: SavedValueModel | null = null;
  if (body.model !== undefined && body.model !== null) {
    const loaded = loadSavedModel(body.model);
    if (!loaded.model) return bad(loaded.error ?? "That saved model could not be read.");
    if (loaded.model.modelId !== modelId) {
      return bad("The saved model does not match the model that priced these rows.");
    }
    if (loaded.model.currencyCode !== currencyCode) {
      return bad(
        `The saved model was fitted in ${loaded.model.currencyCode} and these rows are in ${currencyCode}.`
      );
    }
    model = loaded.model;
  }

  let rows: FeedRow[];
  try {
    rows = parseRows(body.rows, currencyCode, modelId);
  } catch (error) {
    return bad((error as Error).message);
  }
  if (rows.length === 0) {
    return bad("There are no leads to publish - none of them had both a usable identifier and a value.");
  }

  const { token, tokenHash, tokenPrefix } = await generateFeedToken();

  try {
    const feed = await repo.createFeed({
      clientId,
      tokenHash,
      tokenPrefix,
      label: typeof body.label === "string" ? body.label.slice(0, 120) : null,
      modelId,
      modelFittedAt: typeof body.modelFittedAt === "string" ? new Date(body.modelFittedAt) : null,
      currencyCode,
      identifier,
    });

    const rowsPublished = await repo.addRows(feed.id, rows);

    // The rows are already safely stored and are what Google fetches, so a
    // model that fails to store costs the feed its ability to refresh itself
    // later - it does not cost the advertiser this publish. Say which happened
    // rather than reporting a success that is only partly true.
    let modelStored = false;
    if (model) {
      try {
        await repo.saveModel(feed.id, model);
        modelStored = true;
      } catch (error) {
        console.error("storing the model for a published feed failed:", error);
      }
    }

    return {
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        // Said once. After this it exists nowhere but the advertiser's
        // clipboard and a hash in our database.
        //
        // The token sits in the path and the URL ends in .csv because Google
        // validates the extension off the end of the URL and rejects anything
        // finishing in a query string.
        feedUrl: `${origin}/v1/feeds/google-ads/${token}.csv`,
        tokenPrefix,
        rowsPublished,
        identifier,
        feedId: feed.id,
        modelStored,
      }),
    };
  } catch (error) {
    console.error("publishing a feed failed:", error);
    return bad("The feed could not be saved. Nothing was published.", 500);
  }
}

// ---------------------------------------------------------------------------
// Has Google actually collected it?
// ---------------------------------------------------------------------------

/**
 * A published feed is a URL handed to a platform that fetches on its own
 * schedule. Between pasting it in and seeing conversions appear, the advertiser
 * has no way to tell the difference between "Google hasn't got round to it yet"
 * and "Google is rejecting it silently" - and those need opposite responses.
 *
 * We already log every fetch, because counting them in a 24h window is the rate
 * limiter. So the answer is sitting in the database and simply was not being
 * shown. This reads it back.
 *
 * Checking status is not fetching: nothing is logged here and nothing counts
 * against the limit, or looking would consume the budget Google needs.
 */
export interface FeedStatus {
  tokenPrefix: string;
  publishedAt: string | null;
  rowsPublished: number;
  currencyCode: string;
  identifier: FeedIdentifier;
  modelId: string;
  /** Newest first. */
  fetches: { at: string; status: number; rowCount: number }[];
  lastSuccessAt: string | null;
  /** Plain-English reading of the log, which is the whole point of the screen. */
  verdict: "never-fetched" | "collecting" | "failing";
  message: string;
}

const STATUS_FETCH_LIMIT = 20;

export async function feedStatus(
  repo: FeedRepository,
  token: string | null,
  now: Date = new Date()
): Promise<HandlerResponse> {
  if (!token?.trim()) return bad("Paste your feed URL to check it.");

  const feed = await repo.findByTokenHash(await hashToken(token.trim()));
  // The same answer a bad token gets from the feed itself: a wrong key must not
  // reveal whether a feed exists.
  if (!feed) return bad("No feed found for that URL. Check you pasted all of it.", 404);
  if (feed.status !== "active") {
    return bad("That feed has been revoked, so Google can no longer collect from it.", 404);
  }

  const fetches = await repo.recentFetches(feed.id, STATUS_FETCH_LIMIT);
  const lastSuccess = fetches.find((f) => f.status === 200) ?? null;

  let verdict: FeedStatus["verdict"];
  let message: string;

  if (fetches.length === 0) {
    verdict = "never-fetched";
    message =
      "Google hasn't collected this feed yet. It fetches on its own schedule after you save the data source, so a wait of up to a day is normal. If it stays empty, the URL never made it into Google Ads.";
  } else if (!lastSuccess) {
    verdict = "failing";
    message = `Google has tried ${fetches.length === 1 ? "once" : `${fetches.length} times`} and not been served a file. Every attempt came back an error, so nothing has reached your account.`;
  } else {
    const hours = Math.round((now.getTime() - lastSuccess.fetchedAt.getTime()) / 3_600_000);
    const when = hours < 1 ? "less than an hour ago" : hours === 1 ? "an hour ago" : `${hours} hours ago`;
    verdict = "collecting";
    message = `Google last collected this feed ${when} and took ${lastSuccess.rowCount.toLocaleString()} ${lastSuccess.rowCount === 1 ? "row" : "rows"}. The loop is closed.`;
  }

  const status: FeedStatus = {
    tokenPrefix: feed.tokenPrefix,
    publishedAt: feed.publishedAt?.toISOString() ?? null,
    rowsPublished: feed.rowsPublished,
    currencyCode: feed.currencyCode,
    identifier: feed.identifier,
    modelId: feed.modelId,
    fetches: fetches.map((f) => ({
      at: f.fetchedAt.toISOString(),
      status: f.status,
      rowCount: f.rowCount,
    })),
    lastSuccessAt: lastSuccess?.fetchedAt.toISOString() ?? null,
    verdict,
    message,
  };

  return { status: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, status }) };
}
