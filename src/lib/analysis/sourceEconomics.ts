import type { MappedDeal, ShadowRoasRow, SourceEconomics } from "./types";
import { groupBy, mean, median, round, sum } from "./helpers";

const UNATTRIBUTED = "(no source recorded)";

/** (d) Per-source counts, close rate and won-value economics, ranked. */
export function sourceEconomics(deals: MappedDeal[]): SourceEconomics[] {
  const grouped = groupBy(deals, (d) => d.source?.trim() || UNATTRIBUTED);

  const rows: SourceEconomics[] = [];
  for (const [source, group] of grouped) {
    const won = group.filter((d) => d.outcome === "won");
    const lost = group.filter((d) => d.outcome === "lost");
    const open = group.filter((d) => d.outcome === "open");
    const closed = won.length + lost.length;

    const wonAmounts = won
      .map((d) => d.amount)
      .filter((a): a is number => a !== null);

    rows.push({
      source,
      total: group.length,
      won: won.length,
      lost: lost.length,
      open: open.length,
      closeRate: closed > 0 ? round(won.length / closed, 4) : null,
      medianWonAmount: median(wonAmounts),
      avgWonAmount: wonAmounts.length ? round(mean(wonAmounts)!) : null,
      totalWonValue: round(sum(wonAmounts)),
    });
  }

  // Rank by realized value — the number that decides where budget should go.
  rows.sort((a, b) => b.totalWonValue - a.totalWonValue);
  return rows;
}

/**
 * Shadow ROAS: what Google currently optimizes toward versus what actually
 * happened. Every lead counts as 1 to Google today, regardless of outcome.
 */
export function shadowRoas(deals: MappedDeal[]): ShadowRoasRow[] {
  const grouped = groupBy(deals, (d) => d.source?.trim() || UNATTRIBUTED);

  const rows: ShadowRoasRow[] = [];
  for (const [source, group] of grouped) {
    const won = group.filter((d) => d.outcome === "won");
    const actualValue = round(
      sum(won.map((d) => d.amount).filter((a): a is number => a !== null))
    );
    rows.push({
      source,
      leads: group.length,
      googleSeesValue: group.length, // one "conversion" apiece
      wonDeals: won.length,
      actualValue,
      actualValuePerLead: group.length > 0 ? round(actualValue / group.length) : 0,
    });
  }

  rows.sort((a, b) => b.actualValue - a.actualValue);
  return rows;
}
