/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { forgetModel, recallModel, rememberModel } from "./storage";
import type { SavedValueModel } from "./savedModel";

const WORKSPACE_STORE = "vbb.workspaceKey.v1";

function model(id: string, baseValue: number): SavedValueModel {
  return {
    formatVersion: 1, modelId: id, fittedAt: "2026-06-01T00:00:00.000Z", fittedOn: 317,
    window: { from: "2026-01-01", to: "2026-06-01" }, currencyCode: "USD",
    baseValue, calibrationFactor: 0.61, cap: 21150,
    factors: [{ key: "industry", label: "Industry", levels: [
      { level: "Manufacturing", multiplier: 1.64, sampleSize: 121, closeRate: 0.32, medianWonAmount: 6800 },
    ] }],
    customSignalKeys: [], claims: [],
  };
}

beforeEach(() => localStorage.clear());

describe("model storage scoped per workspace", () => {
  it("KEEPS TWO CUSTOMERS' MODELS APART on one laptop", () => {
    // The failure this prevents: an operator onboarding five customers in a
    // row, each overwriting the last, with the wrong multipliers quietly
    // applied to the wrong advertiser.
    localStorage.setItem(WORKSPACE_STORE, "vbb_ws_" + "a".repeat(32));
    rememberModel(model("northridge", 1993.73));

    localStorage.setItem(WORKSPACE_STORE, "vbb_ws_" + "b".repeat(32));
    rememberModel(model("acme", 812.4));
    expect(recallModel()?.modelId).toBe("acme");

    localStorage.setItem(WORKSPACE_STORE, "vbb_ws_" + "a".repeat(32));
    expect(recallModel()?.modelId).toBe("northridge");
    expect(recallModel()?.baseValue).toBe(1993.73);
  });

  it("still works with no workspace key at all", () => {
    rememberModel(model("solo", 1000));
    expect(recallModel()?.modelId).toBe("solo");
  });

  it("does not lose a model saved before scoping existed", () => {
    localStorage.setItem("vbb.savedModel.v1", JSON.stringify(model("legacy", 900)));
    localStorage.setItem(WORKSPACE_STORE, "vbb_ws_" + "c".repeat(32));
    expect(recallModel()?.modelId).toBe("legacy");
  });

  it("prefers this workspace's model over the unscoped one", () => {
    localStorage.setItem("vbb.savedModel.v1", JSON.stringify(model("legacy", 900)));
    localStorage.setItem(WORKSPACE_STORE, "vbb_ws_" + "d".repeat(32));
    rememberModel(model("current", 1200));
    expect(recallModel()?.modelId).toBe("current");
  });

  it("forgetting clears the unscoped copy too, or it comes back", () => {
    localStorage.setItem("vbb.savedModel.v1", JSON.stringify(model("legacy", 900)));
    localStorage.setItem(WORKSPACE_STORE, "vbb_ws_" + "e".repeat(32));
    rememberModel(model("current", 1200));
    forgetModel();
    expect(recallModel()).toBeNull();
  });

  it("does not store the workspace key a second time", () => {
    const key = "vbb_ws_" + "f".repeat(32);
    localStorage.setItem(WORKSPACE_STORE, key);
    rememberModel(model("x", 1000));
    const slots = Object.keys(localStorage).filter((k) => k.startsWith("vbb.savedModel"));
    expect(slots).toHaveLength(1);
    expect(slots[0]).not.toContain(key);
  });
});
