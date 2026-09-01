import type { SyncRun } from "./runs";

/**
 * Whether Google can still match the leads we are sending.
 *
 * This is the failure the rest of the run history cannot see. A site's click
 * ID capture breaks - a form script replaced, a redirect stripping the query
 * string, a consent banner blocking the cookie - and every number already on
 * the workspace page stays healthy. Leads are pulled, priced, published, the
 * run is green. They simply arrive at Google carrying nothing to match them
 * to, and the campaign learns from nobody.
 *
 * Two decisions here matter more than the code:
 *
 * 1. **Measured against their own history, never against a fixed share.** An
 *    absolute floor ("alert under 80% matched") sounds reasonable and is
 *    wrong: a click ID reaches the CRM for the leads who arrived by ad and
 *    nobody else, so a healthy account with plenty of organic traffic sits
 *    permanently low. Their own trailing median is the only honest baseline,
 *    which is principle 2 applied to a monitor rather than to a value.
 *
 * 2. **It reports a drop, never a cause.** We hold counts and no rows, so we
 *    cannot name the form, the page or the campaign that broke - and we are
 *    not going to start storing those to make an alert more specific. The
 *    check says what fell and how far, and the person who owns the site finds
 *    out why.
 */

/** Below this, a night's swing is small numbers rather than a signal. */
export const MIN_LEADS = 30;

/** Nights of history needed before a baseline means anything. */
export const MIN_BASELINE_RUNS = 3;

/** Percentage points below the baseline that count as a break, not a wobble. */
export const DROP = 0.15;

export interface TrackingCheck {
  /** Share of the latest run's leads carrying any identifier, 0 to 1. */
  matched: number;
  /** Their own trailing median, the thing `matched` is judged against. */
  baseline: number;
  /** Leads in the latest run Google has nothing to match on. */
  unmatchable: number;
  leads: number;
}

export type TrackingVerdict =
  | { kind: "not-measured" }
  | { kind: "too-few"; leads: number; needed: number }
  | { kind: "no-baseline"; runs: number; needed: number }
  | ({ kind: "steady" } & TrackingCheck)
  | ({ kind: "dropped" } & TrackingCheck);

function matchedShare(run: SyncRun): number | null {
  const c = run.coverage;
  if (!c || c.total === 0) return null;
  return (c.total - c.neither) / c.total;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * @param runs Newest first, as the store returns them.
 */
export function trackingHealth(runs: SyncRun[]): TrackingVerdict {
  const measured = runs.filter((r) => r.coverage !== null && r.coverage.total > 0);
  const latest = measured[0];
  if (!latest || !latest.coverage) return { kind: "not-measured" };

  const leads = latest.coverage.total;
  if (leads < MIN_LEADS) return { kind: "too-few", leads, needed: MIN_LEADS };

  /*
   * The baseline excludes the run being judged. Including it drags the median
   * toward the very number we are testing, which is how a slow decline over
   * three weeks never trips anything.
   */
  const earlier = measured
    .slice(1)
    .map(matchedShare)
    .filter((s): s is number => s !== null);

  if (earlier.length < MIN_BASELINE_RUNS) {
    return { kind: "no-baseline", runs: earlier.length, needed: MIN_BASELINE_RUNS };
  }

  const matched = matchedShare(latest)!;
  const baseline = median(earlier);
  const check: TrackingCheck = {
    matched,
    baseline,
    unmatchable: latest.coverage.neither,
    leads,
  };

  return baseline - matched >= DROP ? { kind: "dropped", ...check } : { kind: "steady", ...check };
}

/**
 * What the workspace page says about it.
 *
 * Split from the verdict so the sentence can be tested against the numbers
 * that produced it. A monitor that says "tracking degraded" and stops has
 * moved the problem rather than reported it.
 */
export function describeTracking(v: TrackingVerdict): { title: string; action: string } | null {
  if (v.kind !== "dropped") return null;

  const now = Math.round(v.matched * 100);
  const was = Math.round(v.baseline * 100);
  return {
    title: `Google can match ${now}% of your leads, down from ${was}%`,
    action:
      `${v.unmatchable.toLocaleString()} of last night's ${v.leads.toLocaleString()} leads ` +
      "carried no click ID and no email, so they were sent with nothing to match them to. " +
      "That is almost always the capture on the site rather than the CRM: check that the " +
      "click ID field is still on the lead form, that the script still runs after any " +
      "consent banner, and that a redirect is not stripping the query string. Values keep " +
      "going out either way, and the leads Google cannot match teach it nothing.",
  };
}
