import { buildFeedCsv } from "./csv";
import { checkRateLimit } from "./rateLimit";
import type { FeedRepository } from "./repository";
import { generateFeedToken, hashIp, hashToken } from "./token";
import { assertStorableRow, type FeedIdentifier, type FeedRow } from "./types";

/**
 * The request handling, separated from how the repository is obtained.
 *
 * The routes are thin wrappers that resolve Supabase from the environment;
 * everything worth getting right — token authorization, the rate limit, what a
 * failed fetch reveals, what the CSV contains — lives here where it can be
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
  origin: string
): Promise<HandlerResponse> {
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const currencyCode = typeof body.currencyCode === "string" ? body.currencyCode.trim() : "";
  const identifier: FeedIdentifier = body.identifier === "email" ? "email" : "clickId";

  if (!modelId) return bad("A feed has to say which model priced it.");
  if (!/^[A-Z]{3}$/.test(currencyCode)) return bad("A feed needs an ISO currency code.");

  let rows: FeedRow[];
  try {
    rows = parseRows(body.rows, currencyCode, modelId);
  } catch (error) {
    return bad((error as Error).message);
  }
  if (rows.length === 0) {
    return bad("There are no leads to publish — none of them had both a usable identifier and a value.");
  }

  const { token, tokenHash, tokenPrefix } = await generateFeedToken();

  try {
    const feed = await repo.createFeed({
      tokenHash,
      tokenPrefix,
      label: typeof body.label === "string" ? body.label.slice(0, 120) : null,
      modelId,
      modelFittedAt: typeof body.modelFittedAt === "string" ? new Date(body.modelFittedAt) : null,
      currencyCode,
      identifier,
    });

    const rowsPublished = await repo.addRows(feed.id, rows);

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
      }),
    };
  } catch (error) {
    console.error("publishing a feed failed:", error);
    return bad("The feed could not be saved. Nothing was published.", 500);
  }
}
