import { describe, expect, it } from "vitest";
import { decideActions, type FeedSummary, type ModelSummary, type ConnectionSummary } from "./overview";
import type { RunHealth } from "@/lib/sync/runs";

const NOW = new Date("2026-06-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const feed = (over: Partial<FeedSummary> = {}): FeedSummary => ({
  id: "feed-1", tokenPrefix: "vbb_live_8f2a", identifier: "clickId",
  currencyCode: "USD", status: "active", rowsPublished: 463,
  publishedAt: hoursAgo(30), createdAt: hoursAgo(200),
  lastFetchedAt: hoursAgo(6), lastFetchStatus: 200, fetchesLast24h: 1,
  ...over,
});

const model = (over: Partial<ModelSummary> = {}): ModelSummary => ({
  modelId: "model-1", fittedAt: hoursAgo(200), fittedOn: 317,
  currencyCode: "USD", factorCount: 4, hasGate: true, gateStage: "Qualified",
  ...over,
});

const connected = (over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  connected: true, provider: "hubspot", scopes: "private-app",
  lastSyncAt: hoursAgo(6), lastSyncStatus: "ok", lastSyncError: null, unreadable: null,
  ...over,
});

const healthy: RunHealth = {
  state: "healthy", message: "Last sync published 84 rows.",
  lastRunAt: hoursAgo(6), lastSuccessAt: hoursAgo(6), action: null,
};

function actions(over: Partial<Parameters<typeof decideActions>[0]> = {}) {
  return decideActions({
    feed: feed(), model: model(), connection: connected(), health: healthy,
    tracking: { kind: "steady", matched: 0.9, baseline: 0.9, unmatchable: 20, leads: 200 },
    now: NOW,
    ...over,
  });
}

describe("what the operator is told to do", () => {
  /*
   * The one failure every other check on this page reports as healthy: the
   * run pulls, prices and publishes, and Google receives leads it has nothing
   * to match to. Attention rather than blocked, because values are still
   * going out and the fix is on the customer's site.
   */
  it("raises a tracking drop that every other check calls healthy", () => {
    const list = actions({
      tracking: { kind: "dropped", matched: 0.3, baseline: 0.9, unmatchable: 140, leads: 200 },
    });
    const found = list.find((a) => /can match/.test(a.title));
    expect(found).toBeDefined();
    expect(found!.severity).toBe("attention");
    expect(found!.action).toContain("140");
  });

  it("says nothing about tracking while it holds steady", () => {
    expect(actions().some((a) => /can match/.test(a.title))).toBe(false);
  });

  it("says everything is working, and names the one thing left", () => {
    const [first] = actions();
    expect(first.severity).toBe("info");
    // The step that makes all of it matter, and the one people skip.
    expect(first.action).toMatch(/Maximize conversion value/);
  });

  it("every problem carries a fix - never a bare status", () => {
    const cases = [
      actions({ feed: null }),
      actions({ model: null }),
      actions({ feed: feed({ status: "revoked" }) }),
      actions({ connection: { ...connected(), connected: false } }),
      actions({ feed: feed({ lastFetchedAt: null }) }),
      actions({ feed: feed({ lastFetchedAt: hoursAgo(200) }) }),
    ];
    for (const items of cases) {
      for (const item of items) {
        expect(item.action.length, item.title).toBeGreaterThan(20);
      }
    }
  });

  it("blocks on a currency mismatch, because the values would look plausible", () => {
    const items = actions({ feed: feed({ currencyCode: "EUR" }), model: model({ currencyCode: "USD" }) });
    const mismatch = items.find((i) => /USD|EUR/.test(i.title));
    expect(mismatch?.severity).toBe("blocked");
    expect(mismatch?.action).toMatch(/exchange rate/);
  });

  it("tells the operator to ask for a reconnection when credentials cannot be read", () => {
    const items = actions({
      connection: { ...connected(), connected: false, unreadable: "The stored CRM credentials could not be read. Reconnect the account." },
    });
    expect(items[0].severity).toBe("blocked");
    expect(items[0].action).toMatch(/reconnect/i);
  });

  it("keeps 'no CRM connected' as attention, not a fault", () => {
    // A customer publishing by hand is a supported way to work, not an error.
    const items = actions({ connection: { ...connected(), connected: false } });
    expect(items.find((i) => /No CRM/.test(i.title))?.severity).toBe("attention");
  });

  it("escalates a stopped cron and marks it as not the operator's to fix", () => {
    const items = actions({
      health: {
        state: "overdue", message: "The nightly sync has not run for 3 days. New leads are not reaching Google.",
        lastRunAt: hoursAgo(72), lastSuccessAt: hoursAgo(72),
        action: "The scheduled job itself has stopped. Escalate to the developer.",
      },
    });
    const overdue = items.find((i) => /not run for/.test(i.title));
    expect(overdue?.severity).toBe("blocked");
    expect(overdue?.developer).toBe(true);
  });

  it("blocks when Google has stopped collecting, even with everything else green", () => {
    // Every upstream part can be perfect while nothing arrives.
    const items = actions({ feed: feed({ lastFetchedAt: hoursAgo(96) }) });
    expect(items[0].severity).toBe("blocked");
    expect(items[0].title).toMatch(/4 days ago/);
  });

  it("does not panic over a feed Google fetched this morning", () => {
    expect(actions({ feed: feed({ lastFetchedAt: hoursAgo(20) }) })[0].severity).toBe("info");
  });

  it("puts the worst thing first", () => {
    const items = actions({
      feed: feed({ currencyCode: "EUR", lastFetchedAt: null }),
      connection: { ...connected(), connected: false },
    });
    expect(items[0].severity).toBe("blocked");
    expect(items[items.length - 1].severity).not.toBe("blocked");
  });

  it("says publish a feed first when there is none, and stops there", () => {
    const items = actions({ feed: null, model: null, connection: { ...connected(), connected: false } });
    // One clear first step beats four problems that are all the same problem.
    expect(items).toHaveLength(1);
    expect(items[0].action).toMatch(/publish a feed/i);
  });

  it("is only 'working' when nothing needs attention", () => {
    expect(actions().every((a) => a.severity === "info")).toBe(true);
    expect(actions({ model: null }).every((a) => a.severity === "info")).toBe(false);
  });
});
