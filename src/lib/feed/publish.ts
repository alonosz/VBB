import type { ValuedLead } from "@/lib/analysis/valueModel";
import { normalizeEmail, sha256Hex } from "@/lib/export/googleAds";
import type { GateValue } from "@/lib/analysis/gateValue";
import { gateStatusFor } from "@/lib/analysis/gateValue";
import type { FeedIdentifier, FeedRow } from "./types";

/**
 * Turning priced leads into the rows Google will fetch.
 *
 * This is where principle 1 stops being a principle and becomes arithmetic.
 * Google ignores a value adjustment sent more than seven days after the
 * original conversion, so an adjustment past that window is not a smaller
 * effect - it is no effect at all, and emitting one would be telling the
 * advertiser we did something we didn't. Those late outcomes are counted and
 * reported as what they actually are: input for the next refit, which prices
 * tomorrow's leads rather than re-bidding yesterday's.
 */

/** Below this, a restated value is not worth the row. */
export const ADJUSTMENT_MIN_CHANGE = 0.2;

/** Google's window. Not ours to tune. */
export const ADJUSTMENT_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

export interface PublishOptions {
  leads: ValuedLead[];
  modelId: string;
  currencyCode: string;
  identifier: FeedIdentifier;
  /** What this feed has already sent, so we know what actually changed. */
  previous?: FeedRow[];
  /**
   * The priced early gate, when the data supports one. A lead that has since
   * reached it is worth more than its day-0 attributes said - and that is the
   * only thing that ever makes a value move.
   */
  gate?: GateValue | null;
  now?: Date;
}

export interface SkipReason {
  reason: string;
  count: number;
}

export interface PublishResult {
  rows: FeedRow[];
  newConversions: number;
  adjustments: number;
  /**
   * Leads whose value moved enough to matter, on a conversion Google will no
   * longer adjust. Nothing is emitted for these - they are why tomorrow's
   * model gets refitted.
   */
  recalibrationOnly: number;
  /** Changes too small to be worth a row. */
  unchanged: number;
  /** Leads whose value rose because they reached the gate in time. */
  gateAdjustments: number;
  /** Reached the gate, but after Google stopped listening. */
  gateTooLate: number;
  skipped: SkipReason[];
}

/**
 * Identity for one lead's conversion, stable across publishes so republishing
 * a feed cannot send Google the same conversion twice.
 */
export async function feedRowKey(identifierValue: string, conversionTime: Date): Promise<string> {
  return sha256Hex(`${identifierValue}|${conversionTime.toISOString()}`);
}

export async function buildFeedRows(opts: PublishOptions): Promise<PublishResult> {
  const now = opts.now ?? new Date();
  const previous = opts.previous ?? [];
  const sentConversions = new Map(
    previous.filter((r) => r.kind === "conversion").map((r) => [r.rowKey, r])
  );
  // The latest value we told Google for a conversion is the one an adjustment
  // has to beat - comparing against the original would resend a change we
  // already sent.
  const latestSent = new Map<string, number>();
  for (const row of previous) {
    latestSent.set(row.rowKey, row.value);
  }

  const rows: FeedRow[] = [];
  const skips = new Map<string, number>();
  const skip = (reason: string) => skips.set(reason, (skips.get(reason) ?? 0) + 1);

  let newConversions = 0;
  let adjustments = 0;
  let recalibrationOnly = 0;
  let unchanged = 0;
  let gateAdjustments = 0;
  let gateTooLate = 0;

  const gate = opts.gate?.available ? opts.gate : null;

  for (const lead of opts.leads) {
    const { deal } = lead;
    let value = lead.value;

    // The gate is the one thing that can move a lead's value after the fact.
    // It only counts when it fired soon enough for Google to still act on it;
    // otherwise the lead keeps its day-0 price and the miss is reported.
    let gateFired = false;
    if (gate?.multiplier) {
      const status = gateStatusFor(deal, gate.stage, now);
      if (status.reached && status.inTime) {
        value = Math.round(value * gate.multiplier * 100) / 100;
        gateFired = true;
      } else if (status.reached) {
        gateTooLate++;
      }
    }

    if (!deal.createdAt) {
      skip("no create date, so there is no conversion time to attach a value to");
      continue;
    }
    if (!(value > 0)) {
      skip("no value the model could price");
      continue;
    }

    /*
     * Both identifiers go on the row whenever the lead has both, because that
     * is what Google asks for: it matches on the click ID and falls back to
     * the email when the click ID never survived. Only a lead carrying neither
     * is left out.
     *
     * The single-column sets still drop a lead missing that one column - the
     * file has nowhere to put it, and a blank identifier is not a conversion.
     */
    const wantsClickId = opts.identifier !== "email";
    const wantsEmail = opts.identifier !== "clickId";

    const clickId = wantsClickId ? deal.clickId?.trim() || null : null;
    const email = wantsEmail ? deal.email?.trim() || null : null;
    const hashedEmail = email ? await sha256Hex(normalizeEmail(email)) : null;

    if (!clickId && !hashedEmail) {
      skip(
        opts.identifier === "clickId"
          ? "no click ID to join the lead to an ad click"
          : opts.identifier === "email"
            ? "no email address to match against"
            : "no click ID and no email address, so nothing to match the lead on"
      );
      continue;
    }

    /*
     * Keyed on the click ID where there is one, the hashed email otherwise -
     * the same order Google matches in.
     *
     * This is our identity for the lead's conversion, not Google's, and it has
     * to stay stable across publishes or a republish resends a conversion as
     * new. It does, as long as the lead keeps the identifiers it arrived with.
     * A lead that gains a click ID in the CRM after we first published it gets
     * a different key and is sent again; that is a CRM backfilling a day-0
     * field weeks later, which is rare, and the alternative - keying on the
     * email always - breaks the far commoner file that has no emails at all.
     */
    const rowKey = await feedRowKey(clickId ?? hashedEmail!, deal.createdAt);
    const base = {
      hashedEmail,
      clickId,
      conversionTime: deal.createdAt,
      value,
      currencyCode: opts.currencyCode,
      modelId: opts.modelId,
      rowKey,
    };

    if (!sentConversions.has(rowKey)) {
      rows.push({ ...base, kind: "conversion" });
      newConversions++;
      continue;
    }

    const sentValue = latestSent.get(rowKey) ?? sentConversions.get(rowKey)!.value;
    const change = sentValue > 0 ? Math.abs(value - sentValue) / sentValue : 1;
    if (change <= ADJUSTMENT_MIN_CHANGE) {
      unchanged++;
      continue;
    }

    const ageDays = (now.getTime() - deal.createdAt.getTime()) / DAY_MS;
    if (ageDays >= ADJUSTMENT_WINDOW_DAYS) {
      // Google would drop this on arrival. Saying so is more useful than
      // sending it and implying it moved a bid.
      recalibrationOnly++;
      continue;
    }

    rows.push({ ...base, kind: "adjustment" });
    adjustments++;
    if (gateFired) gateAdjustments++;
  }

  return {
    rows,
    newConversions,
    adjustments,
    recalibrationOnly,
    unchanged,
    gateAdjustments,
    gateTooLate,
    skipped: [...skips.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

/** How many of these leads carry each identifier. */
export interface IdentifierCoverage {
  clicks: number;
  emails: number;
  /** Leads with neither, which no feed can carry. Counted, never guessed at. */
  neither: number;
  total: number;
  identifier: FeedIdentifier;
}

/**
 * Which identifier columns this file can fill, and how well.
 *
 * Not a choice anybody is offered. This used to pick the column with the wider
 * coverage and send only that one, which threw away every lead the other column
 * would have caught - and there was no reason for it. Google takes both in one
 * row, matches on the click ID, and uses the email only where the click ID is
 * missing.
 *
 * The single-column answers are the honest ones for a file that only has one:
 * a file with no emails should not be sent through the enhanced conversions
 * setup for the sake of an empty column, and a file with no click IDs cannot
 * pretend otherwise.
 */
export function identifiersFor(leads: ValuedLead[]): IdentifierCoverage {
  let clicks = 0;
  let emails = 0;
  let neither = 0;
  for (const { deal } of leads) {
    const hasClick = Boolean(deal.clickId?.trim());
    const hasEmail = Boolean(deal.email?.trim());
    if (hasClick) clicks++;
    if (hasEmail) emails++;
    // Counted rather than inferred from the other two: a lead carrying both is
    // in both counts, so `clicks + emails` says nothing about who is left out.
    if (!hasClick && !hasEmail) neither++;
  }
  const identifier: FeedIdentifier =
    clicks > 0 && emails > 0 ? "both" : emails > 0 ? "email" : "clickId";
  return { clicks, emails, neither, total: leads.length, identifier };
}
