import type { AdsClient } from "./client";
import { formatConversionTime } from "@/lib/export/googleAds";
import type { FeedRow } from "@/lib/feed/types";

/**
 * Sending the values, and hearing back.
 *
 * The rows are the same `FeedRow`s the CSV route publishes - built in the
 * browser, from the model on screen, and already through every emit rule. This
 * file only changes how they travel. Nothing downstream knows or cares which
 * route was used, which is the same promise the CSV upload and the HubSpot
 * connection make to each other.
 *
 * What is different is that Google answers. A feed is a shout into the dark: a
 * rejected row is never reported to anyone, so an advertiser can publish a
 * thousand conversions, have every one refused, and see only that nothing
 * happened. Here `partialFailure` is on, so the good rows land and the bad
 * ones come back with a reason attached to the row that caused them.
 */

/** Google's cap for a single upload call. */
export const MAX_ROWS_PER_CALL = 2000;

export interface UploadOptions {
  client: AdsClient;
  customerId: string;
  /** The action created by `ensureConversionAction`. */
  conversionActionResourceName: string;
  rows: FeedRow[];
}

export interface RowFailure {
  /** Which row, so a message can name the lead rather than a row number. */
  rowKey: string;
  errorCode: string | null;
  message: string;
}

export interface UploadOutcome {
  /** Rows Google took. */
  accepted: number;
  failures: RowFailure[];
}

interface PartialFailureError {
  code?: number;
  message?: string;
  details?: {
    errors?: {
      errorCode?: Record<string, string>;
      message?: string;
      location?: {
        fieldPathElements?: { fieldName?: string; index?: number }[];
      };
    }[];
  }[];
}

interface UploadResponse {
  results?: unknown[];
  partialFailureError?: PartialFailureError;
}

/**
 * Google reports partial failures by index into the batch we sent, so the
 * mapping back to a lead is ours to do. Getting it wrong would attach a
 * reason to the wrong lead, which is worse than reporting none at all.
 */
export function readPartialFailures(
  error: PartialFailureError | undefined,
  rows: FeedRow[]
): RowFailure[] {
  const failures: RowFailure[] = [];
  for (const detail of error?.details ?? []) {
    for (const err of detail.errors ?? []) {
      const index = err.location?.fieldPathElements?.find(
        (e) => e.fieldName === "conversions" || e.fieldName === "operations"
      )?.index;
      const row = typeof index === "number" ? rows[index] : undefined;
      failures.push({
        rowKey: row?.rowKey ?? "",
        errorCode: err.errorCode ? Object.values(err.errorCode)[0] ?? null : null,
        message: err.message?.trim() || "Google refused this row without saying why.",
      });
    }
  }
  return failures;
}

/**
 * One row, in Google's shape.
 *
 * Both identifiers go on when the lead has both, for the same reason the CSV
 * carries both columns: Google matches on the click ID and falls back to the
 * hashed email for the leads whose click ID never survived. The email is
 * already a SHA-256 hash by the time it reaches here - an address never gets
 * this far, and the database would refuse to store one that had.
 */
export function conversionPayload(row: FeedRow, conversionActionResourceName: string) {
  const payload: Record<string, unknown> = {
    conversionAction: conversionActionResourceName,
    conversionDateTime: formatConversionTime(row.conversionTime),
    conversionValue: row.value,
    currencyCode: row.currencyCode,
    // Our own identity for this conversion. Google uses it to deduplicate, so
    // republishing cannot send the same lead twice.
    orderId: row.rowKey,
  };
  if (row.clickId) payload.gclid = row.clickId;
  if (row.hashedEmail) {
    payload.userIdentifiers = [{ hashedEmail: row.hashedEmail }];
  }
  return payload;
}

/** An adjustment restates what a conversion was worth. */
export function adjustmentPayload(row: FeedRow, conversionActionResourceName: string) {
  return {
    conversionAction: conversionActionResourceName,
    adjustmentType: "RESTATEMENT",
    // Which conversion is being restated: the same identity we sent with it.
    orderId: row.rowKey,
    adjustmentDateTime: formatConversionTime(new Date()),
    restatementValue: {
      adjustedValue: row.value,
      currencyCode: row.currencyCode,
    },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * New conversions.
 *
 * Only rows the publisher marked as conversions. An adjustment sent here would
 * be counted as a second lead rather than a restatement of the first.
 */
export async function uploadConversions(opts: UploadOptions): Promise<UploadOutcome> {
  const rows = opts.rows.filter((r) => r.kind === "conversion");
  return send(opts, rows, "uploadClickConversions", "conversions", (r) =>
    conversionPayload(r, opts.conversionActionResourceName)
  );
}

/**
 * Restated values, for leads that reached the early gate in time.
 *
 * `buildFeedRows` has already refused anything outside Google's seven days, so
 * every row arriving here is one Google will still act on. That rule is not
 * re-implemented here: two copies of it would eventually disagree, and the one
 * that drifted would be quietly telling an advertiser we moved a bid we did
 * not move.
 */
export async function uploadAdjustments(opts: UploadOptions): Promise<UploadOutcome> {
  const rows = opts.rows.filter((r) => r.kind === "adjustment");
  return send(opts, rows, "uploadConversionAdjustments", "conversionAdjustments", (r) =>
    adjustmentPayload(r, opts.conversionActionResourceName)
  );
}

async function send(
  opts: UploadOptions,
  rows: FeedRow[],
  endpoint: string,
  field: string,
  toPayload: (row: FeedRow) => unknown
): Promise<UploadOutcome> {
  if (rows.length === 0) return { accepted: 0, failures: [] };

  let accepted = 0;
  const failures: RowFailure[] = [];

  for (const batch of chunk(rows, MAX_ROWS_PER_CALL)) {
    const res = await opts.client.post<UploadResponse>(
      `customers/${opts.customerId}:${endpoint}`,
      {
        [field]: batch.map(toPayload),
        // On, always. Without it one malformed row refuses the whole batch,
        // and a night's values are lost to a single bad lead.
        partialFailure: true,
        validateOnly: false,
      }
    );

    const batchFailures = readPartialFailures(res.partialFailureError, batch);
    failures.push(...batchFailures);
    accepted += batch.length - batchFailures.length;
  }

  return { accepted, failures };
}

/**
 * What to tell the advertiser, in their words.
 *
 * A run that accepted nothing and a run that had nothing to send are different
 * events, and reporting them the same way is how "it is working" and "it has
 * been broken for a week" become indistinguishable.
 */
export function describeOutcome(outcome: UploadOutcome, kind: "conversion" | "adjustment"): string {
  const noun = kind === "conversion" ? "conversion" : "value update";
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`);

  if (outcome.accepted === 0 && outcome.failures.length === 0) {
    return `No new ${plural(2)} to send.`;
  }
  if (outcome.failures.length === 0) {
    return `Google accepted ${outcome.accepted.toLocaleString()} ${plural(outcome.accepted)}.`;
  }
  if (outcome.accepted === 0) {
    return (
      `Google refused all ${outcome.failures.length.toLocaleString()} ` +
      `${plural(outcome.failures.length)}. First reason: ${outcome.failures[0].message}`
    );
  }
  return (
    `Google accepted ${outcome.accepted.toLocaleString()} ${plural(outcome.accepted)} and ` +
    `refused ${outcome.failures.length.toLocaleString()}. First reason: ${outcome.failures[0].message}`
  );
}
