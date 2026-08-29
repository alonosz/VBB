/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearFlow, loadFlow, needsReupload, saveFlow, type FlowSnapshot } from "./persist";

const CURRENCY = { reportingCurrency: "USD", rates: {}, excludeUnconvertible: true };

function snapshot(over: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    businessContext: "We sell to mid-market manufacturers.",
    statedCycleDays: 45,
    statedSizeBands: ["50-100"],
    file: {
      name: "deals.csv",
      sizeBytes: 4096,
      headers: ["record_id", "amount"],
      rows: [{ record_id: "1", amount: "8200" }],
    },
    fields: [],
    issues: [],
    stageTiming: [],
    currency: CURRENCY,
    intake: null,
    ...over,
  } as FlowSnapshot;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("keeping the flow across a refresh", () => {
  it("round-trips the work a customer has done", () => {
    saveFlow(snapshot());
    const restored = loadFlow();

    expect(restored?.businessContext).toBe("We sell to mid-market manufacturers.");
    expect(restored?.statedCycleDays).toBe(45);
    expect(restored?.file?.name).toBe("deals.csv");
    expect(restored?.file?.rows).toHaveLength(1);
    expect(restored?.rowsDropped).toBe(false);
  });

  it("uses session storage, so a raw CRM export does not outlive the tab", () => {
    saveFlow(snapshot());
    // The uploaded file is the customer's pipeline - names, addresses,
    // amounts. A shared machine must not show it the next morning.
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it("keeps the mapping and drops the rows when the export is too large", () => {
    const huge = Array.from({ length: 60_000 }, (_, i) => ({
      record_id: String(i),
      amount: "8200",
      notes: "x".repeat(60),
    }));
    saveFlow(snapshot({ file: { name: "big.csv", sizeBytes: 9e6, headers: ["a"], rows: huge } }));

    const restored = loadFlow();
    // The file is on their disk and takes seconds to re-select. The mapping is
    // the work, so that is what survives.
    expect(restored?.rowsDropped).toBe(true);
    expect(restored?.file?.rows).toHaveLength(0);
    expect(restored?.file?.name).toBe("big.csv");
    expect(restored?.businessContext).toBe("We sell to mid-market manufacturers.");
    expect(needsReupload(restored)).toBe(true);
  });

  it("still keeps the mapping when storage refuses everything", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    saveFlow(snapshot());
    // First write failed; the second, without rows, is the fallback.
    expect(loadFlow()?.rowsDropped).toBe(true);
  });

  it("does not throw when storage is unavailable at all", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    // A private window is not a reason to break the flow.
    expect(() => saveFlow(snapshot())).not.toThrow();
    expect(loadFlow()).toBeNull();
  });

  it("discards a snapshot from an older format rather than half-restoring it", () => {
    sessionStorage.setItem("vbb.diagnostic.v1", JSON.stringify({ version: 0, fields: ["junk"] }));
    // A partly restored mapping is worse than none: the customer would not
    // know which of their choices survived.
    expect(loadFlow()).toBeNull();
    expect(sessionStorage.getItem("vbb.diagnostic.v1")).toBeNull();
  });

  it("discards unparseable content", () => {
    sessionStorage.setItem("vbb.diagnostic.v1", "{not json");
    expect(loadFlow()).toBeNull();
  });

  it("survives a snapshot missing fields it expects", () => {
    sessionStorage.setItem("vbb.diagnostic.v1", JSON.stringify({ version: 1 }));
    const restored = loadFlow();
    expect(restored).not.toBeNull();
    expect(restored?.fields).toEqual([]);
    expect(restored?.currency.reportingCurrency).toBe("USD");
  });

  it("start over actually removes the data, not just the screen", () => {
    saveFlow(snapshot());
    clearFlow();
    expect(loadFlow()).toBeNull();
    expect(sessionStorage.getItem("vbb.diagnostic.v1")).toBeNull();
  });

  it("has nothing to re-upload when the rows came back", () => {
    saveFlow(snapshot());
    expect(needsReupload(loadFlow())).toBe(false);
    expect(needsReupload(null)).toBe(false);
  });
});
