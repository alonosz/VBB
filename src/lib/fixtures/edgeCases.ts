import type { MappedDeal } from "@/lib/analysis/types";

/**
 * Hand-built fixtures, one per edge case the spec requires coverage for.
 * These are small and explicit so a failing assertion points at a real
 * behavior rather than at generator randomness.
 */

const BASE = new Date("2026-06-01T00:00:00Z");

function day(offset: number): Date {
  return new Date(BASE.getTime() + offset * 86_400_000);
}

export const NOW = day(120);

function deal(partial: Partial<MappedDeal> & { id: string }): MappedDeal {
  return {
    createdAt: day(0),
    closedAt: null,
    outcome: "open",
    amount: null,
    stage: null,
    source: "Paid Search",
    email: null,
    clickId: null,
    ...partial,
  };
}

/** Empty input - every function must degrade without throwing. */
export const EMPTY: MappedDeal[] = [];

/** Stage durations in seconds: the retroactive card-dragging fingerprint. */
export const BACKFILLED_STAGES: MappedDeal[] = [
  ...Array.from({ length: 8 }, (_, i) =>
    deal({
      id: `bf-${i}`,
      outcome: "won",
      amount: 5000,
      closedAt: day(5),
      // 9-second transitions - nobody lived through this stage.
      stageDurations: { Qualified: 9, Proposal: 172800 },
      stageReachedAfterDays: { Qualified: 1, Proposal: 3 },
    })
  ),
  ...Array.from({ length: 2 }, (_, i) =>
    deal({
      id: `bf-real-${i}`,
      outcome: "won",
      amount: 5000,
      closedAt: day(9),
      stageDurations: { Qualified: 86400, Proposal: 172800 },
      stageReachedAfterDays: { Qualified: 2, Proposal: 5 },
    })
  ),
];

/** No stage-duration data at all - the check must skip, not guess. */
export const NO_STAGE_DATA: MappedDeal[] = Array.from({ length: 5 }, (_, i) =>
  deal({ id: `ns-${i}`, outcome: "won", amount: 3000, closedAt: day(4) })
);

/** Every won deal closes the same day it was created. */
export const SAME_DAY_CLOSES: MappedDeal[] = Array.from({ length: 10 }, (_, i) =>
  deal({
    id: `sd-${i}`,
    outcome: "won",
    amount: 2500,
    createdAt: day(i),
    closedAt: day(i),
  })
);

/** A $200k deal among $2k deals - the cap must clip exactly one. */
export const OUTLIER_AMONG_SMALL: MappedDeal[] = [
  ...Array.from({ length: 20 }, (_, i) =>
    deal({ id: `sm-${i}`, outcome: "won", amount: 2000, closedAt: day(3) })
  ),
  deal({ id: "whale", outcome: "won", amount: 200_000, closedAt: day(3) }),
];

/** 12% identifier coverage - must trip the tracking-gap finding. */
export const LOW_MATCH_RATE: MappedDeal[] = Array.from({ length: 50 }, (_, i) =>
  deal({
    id: `lm-${i}`,
    outcome: i < 10 ? "won" : "lost",
    amount: i < 10 ? 4000 : null,
    closedAt: day(6),
    email: i < 6 ? `person${i}@acme.com` : null,
    clickId: null,
  })
);

/** Nothing has ever closed won. Close rate must be 0, not null or NaN. */
export const ZERO_CLOSE_RATE: MappedDeal[] = Array.from({ length: 15 }, (_, i) =>
  deal({ id: `zc-${i}`, outcome: "lost", amount: null, closedAt: day(8) })
);

/** Won deals with no amount recorded - excluded from value math, not zeroed. */
export const MISSING_AMOUNTS: MappedDeal[] = [
  ...Array.from({ length: 6 }, (_, i) =>
    deal({ id: `ma-none-${i}`, outcome: "won", amount: null, closedAt: day(5) })
  ),
  ...Array.from({ length: 4 }, (_, i) =>
    deal({ id: `ma-some-${i}`, outcome: "won", amount: 6000, closedAt: day(5) })
  ),
];

/** Long sales cycle - must classify LONG and steer the verdict to PREDICTED. */
export const LONG_CYCLE: MappedDeal[] = Array.from({ length: 40 }, (_, i) =>
  deal({
    id: `lc-${i}`,
    outcome: "won",
    amount: 9000,
    createdAt: day(i % 30),
    closedAt: day((i % 30) + 95),
    email: `buyer${i}@acme.com`,
  })
);

/** Two sources with deliberately different economics. */
export const TWO_SOURCES: MappedDeal[] = [
  ...Array.from({ length: 10 }, (_, i) =>
    deal({
      id: `hi-${i}`,
      source: "Webinar",
      outcome: i < 5 ? "won" : "lost",
      amount: i < 5 ? 10_000 : null,
      closedAt: day(4),
      email: `a${i}@corp.com`,
    })
  ),
  ...Array.from({ length: 10 }, (_, i) =>
    deal({
      id: `lo-${i}`,
      source: "Paid Social",
      outcome: i < 1 ? "won" : "lost",
      amount: i < 1 ? 2000 : null,
      closedAt: day(4),
      email: `b${i}@gmail.com`,
    })
  ),
];

/** Corporate vs free webmail split, with corporate worth clearly more. */
export const DOMAIN_SPLIT: MappedDeal[] = [
  ...Array.from({ length: 12 }, (_, i) =>
    deal({
      id: `corp-${i}`,
      outcome: i < 6 ? "won" : "lost",
      amount: i < 6 ? 12_000 : null,
      closedAt: day(5),
      email: `person${i}@northwind-mfg.com`,
    })
  ),
  ...Array.from({ length: 12 }, (_, i) =>
    deal({
      id: `free-${i}`,
      outcome: i < 2 ? "won" : "lost",
      amount: i < 2 ? 3000 : null,
      closedAt: day(5),
      email: `person${i}@gmail.com`,
    })
  ),
];
