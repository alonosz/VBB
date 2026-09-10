import { describe, expect, it } from "vitest";
import { identifierOfRows, storeApiPublish } from "./apiPublish";
import { InMemoryFeedRepository } from "./repository";
import type { FeedRow } from "./types";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { saveValueModel } from "@/lib/model/savedModel";
import { withOverrides } from "@/lib/analysis/valueModel";

const NOW = new Date("2026-09-10T15:00:00Z");

function row(over: Partial<FeedRow> = {}): FeedRow {
  return {
    hashedEmail: null,
    clickId: "Cj0KCQexampleclick01",
    conversionTime: new Date("2026-09-09T10:00:00Z"),
    value: 120,
    currencyCode: "USD",
    modelId: "model-1",
    kind: "conversion",
    rowKey: "k1",
    ...over,
  };
}

function model() {
  const deals = generateDemoDeals();
  const fitted = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now: NOW });
  return saveValueModel(withOverrides(fitted.valueModel, deals, {}), {
    deals, modelId: "model-1", gate: fitted.gate, now: NOW,
  });
}

describe("identifierOfRows", () => {
  it("reads the identifier set off the rows", () => {
    expect(identifierOfRows([row()])).toBe("clickId");
    expect(identifierOfRows([row({ clickId: null, hashedEmail: "a".repeat(64) })])).toBe("email");
    expect(identifierOfRows([row(), row({ rowKey: "k2", clickId: null, hashedEmail: "a".repeat(64) })])).toBe("both");
  });
});

describe("storeApiPublish", () => {
  it("keeps the send as an api feed with its rows delivered and its model", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const out = await storeApiPublish(repo, {
      clientId: "ws-1", rows: [row()], modelId: "model-1", currencyCode: "USD", model: model(), now: NOW,
    });

    expect(out.feed.delivery).toBe("api");
    expect(out.rowsStored).toBe(1);
    expect(out.modelStored).toBe(true);
    expect(await repo.pendingRows(out.feed.id)).toEqual([]);
    expect(repo.deliveredAt(out.feed.id, "k1")).toEqual(NOW);
    expect((await repo.modelFor(out.feed.id)).model?.modelId).toBe("model-1");
  });

  it("replaces the previous api feed and leaves url feeds alone", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const url = await repo.createFeed({
      clientId: "ws-1", tokenHash: "b".repeat(64), tokenPrefix: "vbb_live_b",
      modelId: "model-1", currencyCode: "USD", identifier: "clickId",
    });
    const first = await storeApiPublish(repo, {
      clientId: "ws-1", rows: [row()], modelId: "model-1", currencyCode: "USD", model: null,
    });
    const second = await storeApiPublish(repo, {
      clientId: "ws-1", rows: [row()], modelId: "model-1", currencyCode: "USD", model: null,
    });

    expect(second.replaced).toBe(1);
    expect((await repo.findById(first.feed.id))?.status).toBe("revoked");
    expect((await repo.findById(second.feed.id))?.status).toBe("active");
    expect((await repo.findById(url.id))?.status).toBe("active");
    expect(second.modelStored).toBe(false);
  });
});
