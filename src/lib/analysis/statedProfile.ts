import type { MappedDeal } from "./types";
import { employeeBand } from "./factors";
import { round } from "./helpers";

/**
 * The claims an advertiser makes on purpose, rather than in passing.
 *
 * A sales cycle typed into a field and a headcount picked from a list are the
 * same kind of thing as a sentence in the free text: a belief, to be held up
 * against the data. Structured input makes them easier to read and easier to
 * check - it does not make them true, and none of it reaches the value model.
 */

export interface SizeBand {
  id: string;
  label: string;
  /** Inclusive lower bound, and exclusive upper (null = no ceiling). */
  min: number;
  max: number | null;
}

/**
 * The bands an advertiser thinks in. Deliberately finer at the small end than
 * the engine's, because "2–10" and "10–50" feel like different businesses even
 * where there are too few deals in each to price them separately.
 */
export const SIZE_BANDS: SizeBand[] = [
  { id: "solo", label: "Individuals / sole traders", min: 1, max: 2 },
  { id: "2-10", label: "2–10", min: 2, max: 11 },
  { id: "10-50", label: "10–50", min: 10, max: 51 },
  { id: "50-100", label: "50–100", min: 50, max: 101 },
  { id: "100-1000", label: "100–1,000", min: 100, max: 1001 },
  { id: "1000+", label: "1,000+", min: 1000, max: null },
];

export function sizeBandById(id: string): SizeBand | undefined {
  return SIZE_BANDS.find((b) => b.id === id);
}

/** Reads back a selection the way the advertiser would say it. */
export function describeSizeSelection(ids: string[]): string {
  const bands = ids.map(sizeBandById).filter((b): b is SizeBand => !!b);
  if (bands.length === 0) return "";
  if (bands.length === 1) return bands[0].label;
  const min = Math.min(...bands.map((b) => b.min));
  const ceilings = bands.map((b) => b.max);
  if (ceilings.some((c) => c === null)) return `${min}+`;
  const max = Math.max(...(ceilings as number[])) - 1;
  return `${min}–${max.toLocaleString()}`;
}

function inSelection(count: number, bands: SizeBand[]): boolean {
  return bands.some((b) => count >= b.min && (b.max === null || count < b.max));
}

export interface SizeFitResult {
  available: boolean;
  /** Share of won revenue from companies inside the stated bands, 0-1. */
  wonRevenueShare: number | null;
  wonInside: number;
  wonOutside: number;
  /** The engine's own bands that the selection touches, for the report. */
  engineBands: string[];
  /** Too few deals carry a headcount to say anything. */
  lowConfidence: boolean;
}

const MIN_DEALS_FOR_FIT = 20;

/**
 * How much of the revenue actually came from the size of company the
 * advertiser named. Won deals only - an open deal has produced nothing yet.
 */
export function sizeFit(deals: MappedDeal[], selectedIds: string[]): SizeFitResult {
  const bands = selectedIds.map(sizeBandById).filter((b): b is SizeBand => !!b);
  const empty: SizeFitResult = {
    available: false, wonRevenueShare: null, wonInside: 0,
    wonOutside: 0, engineBands: [], lowConfidence: false,
  };
  if (bands.length === 0) return empty;

  const won = deals.filter(
    (d) =>
      d.outcome === "won" &&
      typeof d.amount === "number" &&
      typeof d.employeeCount === "number" &&
      Number.isFinite(d.employeeCount)
  );
  if (won.length === 0) return empty;

  let inside = 0;
  let insideRevenue = 0;
  let outsideRevenue = 0;
  const engineBands = new Set<string>();

  for (const deal of won) {
    const count = deal.employeeCount!;
    if (inSelection(count, bands)) {
      inside++;
      insideRevenue += deal.amount!;
      const band = employeeBand(count);
      if (band) engineBands.add(band);
    } else {
      outsideRevenue += deal.amount!;
    }
  }

  const total = insideRevenue + outsideRevenue;
  return {
    available: true,
    wonRevenueShare: total > 0 ? round(insideRevenue / total, 4) : null,
    wonInside: inside,
    wonOutside: won.length - inside,
    engineBands: [...engineBands],
    lowConfidence: won.length < MIN_DEALS_FOR_FIT,
  };
}
