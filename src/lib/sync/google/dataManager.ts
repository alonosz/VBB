import type { FeedRow } from "@/lib/feed/types";

/** Confirmed by probe on 1 Sept 2026: 401 here, 404 on every other spelling. */
export const DATA_MANAGER_ORIGIN = "https://datamanager.googleapis.com";
export const INGEST_PATH = "v1/events:ingest";

/**
 * Required for every Data Manager service, and deliberately not the Ads API's
 * `adwords` scope - Google's upgrade guide says in bold that new credentials
 * are needed. It is also a *sensitive* scope, which is an operational cost
 * rather than a line of code: the Cloud project has to declare it under Data
 * Access, and the OAuth app needs Google's verification or every customer
 * meets an "unverified app" warning on the way in.
 */
export const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";

/**
 * The Data Manager API request, which is where offline conversions live now.
 *
 * Google closed `ConversionUploadService.UploadClickConversions` to new
 * adopters on 15 June 2026 - the allowlist is whoever was already calling it
 * between December 2025 and May 2026, and this project was approved in
 * August. There is no application, so the old service is not coming back for
 * us. This is the replacement, and it is the only route by which a value can
 * reach Google over an API.
 *
 * Only the transport changes. What a lead is worth, which identifiers it
 * carries, and the seven-day rule about when a value may be restated are all
 * decided before anything here is called, and none of it moves.
 *
 * Four differences from the old service matter enough to name, because each
 * one changes what the product can honestly claim:
 *
 * 1. No developer token. Its header is gone, and the account information it
 *    used to carry now travels inside the destination.
 * 2. Fast-fail, not partial failure. One bad row rejects the entire request,
 *    where the old service accepted the good ones and reported the rest. So
 *    "which of your rows Google took" stops being answerable per row.
 * 3. Processing is asynchronous. The response carries a request id, not an
 *    accepted count; results arrive later through diagnostics.
 * 4. The destination names a numeric conversion action id, not a resource
 *    name, and the operating account must own that action rather than merely
 *    be a parent of the account that does.
 */

/** Google Ads account ids reach us as resource names; the API wants the id. */
export function conversionActionId(resourceName: string): string | null {
  // "customers/1234567890/conversionActions/987654321"
  const match = /conversionActions\/(\d+)\s*$/.exec(resourceName.trim());
  return match ? match[1] : null;
}

/**
 * RFC 3339, which is not the format the Google Ads API wanted.
 *
 * The old service took "2026-04-01 13:05:00+00:00"; this one takes
 * "2026-04-01T13:05:00.000Z". Close enough to look interchangeable and not
 * be, which is exactly the kind of difference that fails a whole request
 * under fast-fail.
 */
export function eventTimestamp(at: Date): string {
  return at.toISOString();
}

export interface DestinationOptions {
  /** The Google Ads account that owns the conversion action. */
  operatingAccountId: string;
  /** Numeric id of the conversion action, not its resource name. */
  conversionActionId: string;
  /** The manager account signing in, when one is used. */
  loginAccountId?: string | null;
}

export function destination(opts: DestinationOptions): Record<string, unknown> {
  const dest: Record<string, unknown> = {
    operatingAccount: {
      accountId: opts.operatingAccountId,
      accountType: "GOOGLE_ADS",
    },
    productDestinationId: opts.conversionActionId,
  };
  if (opts.loginAccountId) {
    dest.loginAccount = { accountId: opts.loginAccountId, accountType: "GOOGLE_ADS" };
  }
  return dest;
}

/**
 * One lead, as an Event.
 *
 * `conversionValue` is in currency units rather than micros, which is the one
 * place the new API is kinder than the old. `transactionId` carries the same
 * per-conversion identity `orderId` did, so republishing still cannot send
 * one lead twice.
 */
export function eventFor(row: FeedRow): Record<string, unknown> {
  const event: Record<string, unknown> = {
    eventTimestamp: eventTimestamp(row.conversionTime),
    conversionValue: row.value,
    currency: row.currencyCode,
    transactionId: row.rowKey,
    /*
     * Required for Google Ads offline conversions, and the field mappings
     * table lists it as "no equivalent" in the old API - so it is the one
     * field nothing in the previous implementation could have suggested.
     * WEB because that is where the lead was captured: a form on their site.
     * Omitting it fails validation, and under fast-fail that is every row.
     */
    eventSource: "WEB",
  };

  if (row.clickId) {
    event.adIdentifiers = { gclid: row.clickId };
  }
  /*
   * Both identifiers travel together where a lead has both, exactly as they
   * did on the old service and in the file: Google matches on the click id
   * and falls back to the email when the click id never arrived.
   */
  if (row.hashedEmail) {
    event.userData = { userIdentifiers: [{ emailAddress: row.hashedEmail }] };
  }
  return event;
}

export interface IngestOptions extends DestinationOptions {
  rows: FeedRow[];
  /** Ask Google to check the request without recording anything. */
  validateOnly?: boolean;
}

/**
 * The whole request body.
 *
 * `encoding` is required and describes how the hashed identifiers are
 * written. We hash to lowercase hex, so HEX it is - the field is not
 * optional and a request without it is rejected whole.
 */
export function ingestEventsRequest(opts: IngestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    destinations: [destination(opts)],
    encoding: "HEX",
    events: opts.rows.map(eventFor),
  };
  if (opts.validateOnly) body.validateOnly = true;
  return body;
}

/**
 * What the response can tell an advertiser, which is less than before.
 *
 * The old service answered per row and the screen could say "Google took 462
 * of your 466". This one accepts or rejects the request as a whole and then
 * processes it out of sight, so the honest report is that it was accepted for
 * processing, with the request id to look it up by. Claiming a per-row result
 * we no longer receive would be inventing the most reassuring number on the
 * screen.
 */
export interface IngestOutcome {
  /** Rows in the request. Not a count of what Google will keep. */
  submitted: number;
  requestId: string | null;
}

export function describeIngest(outcome: IngestOutcome): string {
  const rows = outcome.submitted.toLocaleString();
  const noun = outcome.submitted === 1 ? "conversion" : "conversions";
  return (
    `Google accepted ${rows} ${noun} for processing. It records them out of ` +
    `sight rather than row by row, so the count that lands is confirmed in ` +
    `your Google Ads conversion reporting rather than here.`
  );
}

export interface IngestResponse {
  requestId: string | null;
  /** Optional fields Google accepted but was unhappy with. */
  fieldWarnings: unknown[];
}

/** The specific field Google objected to, when it names one. */
interface ErrorBody {
  error?: {
    message?: string;
    details?: { fieldViolations?: { field?: string; description?: string; reason?: string }[] }[];
  };
}

/**
 * Google names the exact field and row it refused on. Passing that through
 * beats a generic failure, because under fast-fail one field in one row is
 * the whole batch, and "events.events[0].user_data.user_identifiers: Email is
 * not hex encoded" is a fix rather than a mystery.
 */
/**
 * The fix, for the refusals that have one.
 *
 * Google's own wording is accurate and useless to the person who has to act on
 * it: "the destination account is not enabled for enhanced conversions for
 * leads" is a setting four clicks away, and nothing on the screen said where.
 * The advertiser reads a rejection they did not cause and cannot place, which
 * is the moment they conclude the product is broken.
 *
 * Matched on Google's text rather than on a reason code because the same
 * refusal arrives under different codes, and an unmatched one simply adds
 * nothing - the raw violation still shows either way.
 */
export function remedyFor(text: string): string | null {
  const t = text.toLowerCase();

  if (t.includes("enhanced conversion") && t.includes("lead")) {
    return (
      "Your rows carry email addresses, and Google only accepts an email once " +
      "this account has enhanced conversions for leads switched on. In Google " +
      "Ads: Goals → Conversions → Settings → Enhanced conversions for leads. " +
      "Tick it on, accept the customer data terms, and pick Google tag as the " +
      "method unless your site is tagged through Tag Manager. That question is " +
      "about how your site collects the email, not about how we send it. Save, " +
      "then send again."
    );
  }

  if (t.includes("hex")) {
    return (
      "The email hashes went out in the wrong case. Nothing for you to do here " +
      "- this is ours to fix."
    );
  }

  if (t.includes("allowlist")) {
    return (
      "This account is not on Google's list for offline conversion imports. " +
      "That is granted by Google, not by us, and it is the one blocker no " +
      "setting on your side clears."
    );
  }

  return null;
}

export function readIngestError(status: number, body: unknown): string {
  const violation = (body as ErrorBody)?.error?.details
    ?.flatMap((d) => d.fieldViolations ?? [])
    .find((v) => v.field || v.reason);

  if (violation) {
    const where = violation.field ? ` at ${violation.field}` : "";
    const why = violation.description ?? violation.reason ?? "";
    const remedy = remedyFor(`${why} ${violation.reason ?? ""}`);
    return (
      `Google rejected the whole batch${where}: ${why} ` +
      "The Data Manager API fails the entire request when any one row is wrong, " +
      "so nothing was recorded." +
      (remedy ? `\n\n${remedy}` : "")
    );
  }

  const message = (body as ErrorBody)?.error?.message?.trim();
  if (message) {
    const remedy = remedyFor(message);
    return remedy ? `${message}\n\n${remedy}` : message;
  }
  return `Google Ads refused the request (HTTP ${status}).`;
}

/**
 * A refusal we understood well enough to repeat.
 *
 * Typed so a route can surface its message and nothing else: an unexpected
 * TypeError should stay in the log, but a sentence built from Google's own
 * field violation is the most useful thing on the screen, and the fallback
 * that ate it made a real cause look like a shrug.
 */
export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface IngestCall extends IngestOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
  origin?: string;
}

/**
 * One request, all rows.
 *
 * No developer token: the Data Manager API does not take one, and the account
 * information it used to carry travels in the destination instead.
 */
export async function ingestEvents(call: IngestCall): Promise<IngestResponse> {
  const fetchImpl = call.fetchImpl ?? fetch;
  const origin = call.origin ?? DATA_MANAGER_ORIGIN;

  const res = await fetchImpl(`${origin}/${INGEST_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${call.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(ingestEventsRequest(call)),
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) throw new IngestError(readIngestError(res.status, body), res.status, body);

  const ok = (body ?? {}) as { requestId?: string; fieldWarnings?: unknown[] };
  return { requestId: ok.requestId ?? null, fieldWarnings: ok.fieldWarnings ?? [] };
}
