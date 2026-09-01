import type { FeedRow } from "@/lib/feed/types";

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
