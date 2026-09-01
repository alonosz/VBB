import { describe, expect, it } from "vitest";
import {
  DROP,
  MIN_BASELINE_RUNS,
  MIN_LEADS,
  describeTracking,
  trackingHealth,
} from "./tracking";
import type { SyncRun } from "./runs";

const NOW = new Date("2026-06-15T12:00:00Z");

/** A night, described by how many of its leads Google could match. */
function night(matched: number, total = 200, over: Partial<SyncRun> = {}): SyncRun {
  const withId = Math.round(total * matched);
  return {
    id: 1,
    feedId: "feed-1",
    clientId: "ws-1",
    startedAt: NOW,
    finishedAt: NOW,
    status: "ok",
    dealsPulled: total,
    rowsPublished: withId,
    newConversions: withId,
    adjustments: 0,
    recalibrationOnly: 0,
    unchanged: 0,
    skipped: total - withId,
    message: null,
    modelId: "model-1",
    coverage: { clicks: withId, emails: 0, neither: total - withId, total },
    ...over,
  };
}

describe("trackingHealth", () => {
  it("says nothing when no run measured coverage", () => {
    expect(trackingHealth([]).kind).toBe("not-measured");
    expect(trackingHealth([night(0.9, 200, { coverage: null })]).kind).toBe("not-measured");
  });

  it("refuses to read a night too small to mean anything", () => {
    const v = trackingHealth([night(0.4, MIN_LEADS - 1), night(0.9), night(0.9), night(0.9)]);
    expect(v.kind).toBe("too-few");
  });

  it("refuses to judge before there is a baseline to judge against", () => {
    const v = trackingHealth([night(0.4), night(0.9), night(0.9)]);
    expect(v).toMatchObject({ kind: "no-baseline", needed: MIN_BASELINE_RUNS });
  });

  /*
   * The whole point. A green run whose leads arrive unmatchable looks healthy
   * in every other column on the page.
   */
  it("catches a capture that broke while the runs stayed green", () => {
    const v = trackingHealth([night(0.3), night(0.86), night(0.9), night(0.88), night(0.91)]);
    expect(v.kind).toBe("dropped");
    if (v.kind !== "dropped") throw new Error("unreachable");
    expect(v.baseline).toBeCloseTo(0.89, 2);
    expect(v.unmatchable).toBe(140);
  });

  /*
   * A permanently low share is not a fault. An account with organic traffic
   * has one, and an absolute floor would call it broken every single night.
   */
  it("leaves a steadily low account alone", () => {
    const v = trackingHealth([night(0.18), night(0.19), night(0.17), night(0.2), night(0.18)]);
    expect(v.kind).toBe("steady");
  });

  it("does not fire on a wobble smaller than the threshold", () => {
    const v = trackingHealth([
      night(0.9 - DROP + 0.02),
      night(0.9),
      night(0.9),
      night(0.9),
      night(0.9),
    ]);
    expect(v.kind).toBe("steady");
  });

  /*
   * A decline that arrives a little each night is the one an operator never
   * notices, so the baseline must exclude the run being judged.
   */
  it("still trips on a slide rather than a cliff", () => {
    const v = trackingHealth([night(0.6), night(0.68), night(0.76), night(0.84), night(0.9)]);
    expect(v.kind).toBe("dropped");
  });

  it("reads the newest run, not the best one", () => {
    const v = trackingHealth([night(0.3), night(0.95), night(0.95), night(0.95)]);
    expect(v.kind).toBe("dropped");
    if (v.kind !== "dropped") throw new Error("unreachable");
    expect(v.matched).toBeCloseTo(0.3, 5);
  });
});

describe("describeTracking", () => {
  it("says nothing at all when nothing dropped", () => {
    expect(describeTracking({ kind: "steady", matched: 0.9, baseline: 0.9, unmatchable: 20, leads: 200 })).toBeNull();
    expect(describeTracking({ kind: "not-measured" })).toBeNull();
  });

  /*
   * The counts have to survive into the sentence: "tracking degraded" is a
   * restatement of the problem, not a report of it.
   */
  it("carries both shares and both counts into what it says", () => {
    const v = trackingHealth([night(0.3), night(0.9), night(0.9), night(0.9)]);
    const said = describeTracking(v)!;
    expect(said.title).toContain("30%");
    expect(said.title).toContain("90%");
    expect(said.action).toContain("140");
    expect(said.action).toContain("200");
  });

  /*
   * We hold counts and no rows, so the check cannot name the broken form and
   * must not pretend to. It points at where to look instead.
   */
  it("points at the site without inventing which page broke", () => {
    const said = describeTracking(trackingHealth([night(0.3), night(0.9), night(0.9), night(0.9)]))!;
    expect(said.action).toMatch(/consent banner|query string|lead form/);
    expect(said.action).not.toMatch(/https?:\/\//);
  });
});
