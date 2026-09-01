import { describe, expect, it } from "vitest";
import { InMemorySyncRunStore, OVERDUE_AFTER_HOURS, runHealth, type SyncRun } from "./runs";

const NOW = new Date("2026-06-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function run(over: Partial<SyncRun> = {}): SyncRun {
  return {
    id: 1, feedId: "feed-1", clientId: "ws-1",
    startedAt: hoursAgo(6), finishedAt: hoursAgo(6),
    status: "ok", dealsPulled: 120, rowsPublished: 84, newConversions: 84,
    adjustments: 0, recalibrationOnly: 0, unchanged: 0, skipped: 36,
    message: null, modelId: "model-1", coverage: null,
    ...over,
  };
}

describe("runHealth", () => {
  it("says nothing has run yet, and what that means", async () => {
    const health = runHealth([], NOW);
    expect(health.state).toBe("never-run");
    // Two very different causes with the same symptom, so the action names both.
    expect(health.action).toMatch(/overnight/);
    expect(health.action).toMatch(/developer/);
  });

  it("reports a healthy run with what it published", () => {
    const health = runHealth([run()], NOW);
    expect(health.state).toBe("healthy");
    expect(health.message).toMatch(/84 rows/);
    expect(health.action).toBeNull();
  });

  it("SEES A CRON THAT STOPPED FIRING, which a stale timestamp cannot", () => {
    // The failure this table exists for: no failed runs, no error anywhere,
    // simply nothing happening.
    const health = runHealth([run({ startedAt: hoursAgo(72) })], NOW);
    expect(health.state).toBe("overdue");
    expect(health.message).toMatch(/3 days/);
    expect(health.message).toMatch(/not reaching Google/);
    expect(health.action).toMatch(/developer/i);
  });

  it("does not cry overdue over one late run", () => {
    // A run a few hours late is a slow night, not an outage.
    expect(runHealth([run({ startedAt: hoursAgo(26) })], NOW).state).toBe("healthy");
    expect(runHealth([run({ startedAt: hoursAgo(OVERDUE_AFTER_HOURS - 1) })], NOW).state).toBe("healthy");
    expect(runHealth([run({ startedAt: hoursAgo(OVERDUE_AFTER_HOURS + 1) })], NOW).state).toBe("overdue");
  });

  it("surfaces the reason a recent run failed, in its own words", () => {
    const health = runHealth(
      [run({ status: "refused", message: "HubSpot would not renew the connection. Reconnect the account." })],
      NOW
    );
    expect(health.state).toBe("failing");
    expect(health.message).toMatch(/Reconnect the account/);
  });

  it("keeps the last success visible while the newest run is failing", () => {
    const health = runHealth(
      [run({ id: 2, status: "failed", message: "The CRM could not be read.", startedAt: hoursAgo(2) }),
       run({ id: 1, startedAt: hoursAgo(26) })],
      NOW
    );
    expect(health.state).toBe("failing");
    // "It broke last night but worked the night before" is a different
    // conversation from "it has never worked".
    expect(health.lastSuccessAt).toEqual(hoursAgo(26));
  });

  it("prefers overdue over failing - a job that stopped is the bigger problem", () => {
    const health = runHealth([run({ status: "failed", message: "x", startedAt: hoursAgo(96) })], NOW);
    expect(health.state).toBe("overdue");
  });
});

describe("InMemorySyncRunStore", () => {
  it("totals the skip reasons rather than storing them one by one", async () => {
    const store = new InMemorySyncRunStore();
    await store.record({
      feedId: "feed-1", clientId: "ws-1", status: "ok", startedAt: NOW,
      report: {
        feedId: "feed-1", modelId: "model-1", dealsPulled: 100, rowsAdded: 60,
        newConversions: 60, adjustments: 0, recalibrationOnly: 3, unchanged: 2,
        gateAdjustments: 0, gateTooLate: 0,
        skipped: [{ reason: "no click ID", count: 30 }, { reason: "no value", count: 5 }],
        coverage: null,
    refusedBecause: null,
      },
    });
    const [recorded] = await store.recentForWorkspace("ws-1", 10);
    expect(recorded.skipped).toBe(35);
    expect(recorded.rowsPublished).toBe(60);
    expect(recorded.recalibrationOnly).toBe(3);
  });

  it("keeps one workspace's history out of another's", async () => {
    const store = new InMemorySyncRunStore();
    await store.record({ feedId: "f1", clientId: "ws-1", status: "ok", startedAt: NOW });
    await store.record({ feedId: "f2", clientId: "ws-2", status: "ok", startedAt: NOW });
    expect(await store.recentForWorkspace("ws-1", 10)).toHaveLength(1);
    expect((await store.recentForWorkspace("ws-1", 10))[0].feedId).toBe("f1");
  });

  it("truncates a message to a sentence", async () => {
    const store = new InMemorySyncRunStore();
    await store.record({
      feedId: "f1", clientId: "ws-1", status: "failed", startedAt: NOW,
      message: "x".repeat(2000),
    });
    expect((await store.recentForWorkspace("ws-1", 1))[0].message).toHaveLength(500);
  });
});
