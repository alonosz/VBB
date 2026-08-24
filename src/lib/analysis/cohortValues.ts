import type { CohortValue, DomainType, MappedDeal } from "./types";
import { classifyDomain, groupBy, median, round } from "./helpers";
import { applyCap } from "./valueSpread";

/** Below this, a source×domain cell is too thin to price on its own. */
export const MIN_CELL_SIZE = 15;

const UNATTRIBUTED = "(no source recorded)";

/**
 * (j) Expected value per segment — close rate × median won amount, capped.
 *
 * This table IS the Day-0 bidding value set. When a new lead arrives with a
 * known source and email domain, its value is looked up here; nothing about
 * that lead's eventual outcome is required, which is precisely why it can be
 * sent on day 0 while it still influences bidding.
 *
 * Thin source×domain cells collapse to source-only rather than reporting a
 * close rate derived from four deals.
 */
export function cohortValueTable(
  deals: MappedDeal[],
  cap: number | null
): CohortValue[] {
  const bySource = groupBy(deals, (d) => d.source?.trim() || UNATTRIBUTED);
  const out: CohortValue[] = [];

  for (const [source, sourceDeals] of bySource) {
    const byDomain = groupBy(sourceDeals, (d) => classifyDomain(d.email));

    // Only split when every populated cell clears the sample floor; a mixed
    // table where one row is solid and another is noise reads as equally
    // authoritative, which it isn't.
    const splittable = [...byDomain].filter(([type]) => type !== "unknown");
    const canSplit =
      splittable.length > 1 &&
      splittable.every(([, group]) => group.length >= MIN_CELL_SIZE);

    if (canSplit) {
      for (const [domainType, group] of splittable) {
        out.push(
          buildRow(`${source} · ${domainType}`, source, domainType as DomainType, group, cap, false)
        );
      }
      // Leads with no usable email still need a price. They're priced off the
      // source-level pool (the only signal available for them), but the row
      // reports how many leads it actually covers — not the size of the pool
      // it borrowed its rate from.
      const unknown = byDomain.get("unknown");
      if (unknown && unknown.length > 0) {
        const row = buildRow(`${source} · no email`, source, null, sourceDeals, cap, true);
        row.sampleSize = unknown.length;
        out.push(row);
      }
    } else {
      out.push(buildRow(source, source, null, sourceDeals, cap, splittable.length > 1));
    }
  }

  out.sort((a, b) => (b.expectedValue ?? 0) - (a.expectedValue ?? 0));
  return out;
}

function buildRow(
  key: string,
  source: string,
  domainType: DomainType | null,
  deals: MappedDeal[],
  cap: number | null,
  collapsed: boolean
): CohortValue {
  const won = deals.filter((d) => d.outcome === "won");
  const lost = deals.filter((d) => d.outcome === "lost");
  const closed = won.length + lost.length;
  const closeRate = closed > 0 ? won.length / closed : null;

  const wonAmounts = won.map((d) => d.amount).filter((a): a is number => a !== null);
  const medianWon = median(wonAmounts);

  // Cap the segment's median before multiplying, so one whale inside a cohort
  // can't inflate every future bid drawn from it.
  const cappedMedian = applyCap(medianWon, cap);

  return {
    key,
    source,
    domainType,
    sampleSize: deals.length,
    closeRate: closeRate === null ? null : round(closeRate, 4),
    medianWonAmount: medianWon,
    expectedValue:
      closeRate !== null && cappedMedian !== null
        ? round(closeRate * cappedMedian)
        : null,
    collapsedToSource: collapsed,
  };
}
