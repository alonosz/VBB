import type { MappedDeal } from "@/lib/analysis/types";
import { valueAllLeads } from "@/lib/analysis/valueModel";
import {
  checkApplicability,
  savedGateToGateValue,
  savedModelToValueModel,
  type SavedValueModel,
} from "@/lib/model/savedModel";
import { bestIdentifier, buildFeedRows } from "@/lib/feed/publish";
import type { FeedRepository } from "@/lib/feed/repository";
import type { FeedRecord } from "@/lib/feed/types";

/**
 * One scheduled run of a feed.
 *
 * What makes this different from a person clicking Publish is that nobody is
 * watching, which changes what the code is allowed to do rather than just when
 * it runs:
 *
 *  - It never refits. The saved model prices today's leads exactly as it
 *    priced yesterday's, because a model that moved every night would reprice
 *    the same lead differently on two days for no reason the advertiser could
 *    see, and Google would be learning from a moving target. Refitting stays a
 *    decision someone makes on screen after seeing what would change.
 *
 *  - It never widens what is stored. CRM rows live in memory for the length of
 *    the run and are never written down; the only thing persisted is the same
 *    feed row a browser would have produced. The server borrows the data, it
 *    does not keep it.
 *
 *  - It refuses rather than guesses. A model fitted in one currency against a
 *    CRM now reporting another would emit numbers that look right and are
 *    wrong by the exchange rate, so the run stops and says so.
 */

export interface SyncReport {
  feedId: string;
  modelId: string;
  /** Deals the CRM handed us, before any pricing. */
  dealsPulled: number;
  /** Rows actually written. */
  rowsAdded: number;
  newConversions: number;
  adjustments: number;
  /** Moved, but too late for Google to act on. Input for the next refit. */
  recalibrationOnly: number;
  unchanged: number;
  gateAdjustments: number;
  gateTooLate: number;
  skipped: { reason: string; count: number }[];
  /** Set when the run refused to do anything. Nothing is written when present. */
  refusedBecause: string | null;
}

function refusal(feed: FeedRecord, modelId: string, dealsPulled: number, why: string): SyncReport {
  return {
    feedId: feed.id,
    modelId,
    dealsPulled,
    rowsAdded: 0,
    newConversions: 0,
    adjustments: 0,
    recalibrationOnly: 0,
    unchanged: 0,
    gateAdjustments: 0,
    gateTooLate: 0,
    skipped: [],
    refusedBecause: why,
  };
}

export interface SyncOptions {
  repo: FeedRepository;
  feed: FeedRecord;
  model: SavedValueModel;
  /** Everything the CRM had. Held in memory only. */
  deals: MappedDeal[];
  /** The currency the CRM is reporting in, if it says. */
  reportingCurrency?: string;
  now?: Date;
}

export async function runSync(opts: SyncOptions): Promise<SyncReport> {
  const { repo, feed, model, deals } = opts;
  const now = opts.now ?? new Date();

  if (feed.status !== "active") {
    return refusal(feed, model.modelId, deals.length, "This feed has been revoked.");
  }

  const applicability = checkApplicability(model, deals, opts.reportingCurrency);
  if (applicability.currencyMismatch) {
    return refusal(feed, model.modelId, deals.length, applicability.currencyMismatch);
  }

  // Every rule inert means the CRM stopped supplying the columns the model was
  // fitted on. Pricing anyway would send Google a flat base value for every
  // lead and call it a model.
  const live = applicability.factors.filter((f) => f.dealsCovered > 0);
  if (model.factors.length > 0 && live.length === 0) {
    return refusal(
      feed,
      model.modelId,
      deals.length,
      "None of this model's rules match the data the CRM returned, so every lead would be priced the same. Check the CRM connection before this runs again."
    );
  }

  const valueModel = savedModelToValueModel(model);
  const leads = valueAllLeads(deals, valueModel);

  const { rows, newConversions, adjustments, recalibrationOnly, unchanged, gateAdjustments, gateTooLate, skipped } =
    await buildFeedRows({
      leads,
      modelId: model.modelId,
      currencyCode: model.currencyCode,
      // Fixed when the feed was published: Google's import carries one
      // identifier type per file, so a run must not switch it because today's
      // pull happens to have more emails than click IDs.
      identifier: feed.identifier,
      previous: await repo.rowsFor(feed.id),
      gate: savedGateToGateValue(model),
      now,
    });

  const rowsAdded = rows.length > 0 ? await repo.addRows(feed.id, rows) : 0;

  return {
    feedId: feed.id,
    modelId: model.modelId,
    dealsPulled: deals.length,
    rowsAdded,
    newConversions,
    adjustments,
    recalibrationOnly,
    unchanged,
    gateAdjustments,
    gateTooLate,
    skipped,
    refusedBecause: null,
  };
}

export { bestIdentifier };
