import { describe, expect, it } from "vitest";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import { saveValueModel } from "@/lib/model/savedModel";
import { buildValueModel } from "@/lib/analysis/valueModel";
import type { MappedDeal } from "@/lib/analysis/types";
import { liveModelFor } from "./liveModel";

const DAY = new Date("2026-06-01T00:00:00Z");
const deals: MappedDeal[] = Array.from({ length: 160 }, (_, i) => ({
  id: `d${i}`,
  createdAt: DAY,
  closedAt: DAY,
  outcome: i % 2 === 0 ? "won" : "lost",
  amount: i % 2 === 0 ? (i < 80 ? 20_000 : 5_000) : null,
  stage: null,
  source: "Paid Search",
  email: i < 80 ? "a@acme.com" : "a@gmail.com",
  clickId: null,
}));
const saved = saveValueModel(buildValueModel({ deals, cap: null, currencyCode: "USD" }), {
  deals,
  now: new Date("2026-06-15T12:00:00Z"),
  modelId: "m1",
});

/** A clock that moves, so "newest" means something. */
function repository() {
  let tick = 0;
  return new InMemoryFeedRepository(() => new Date(DAY.getTime() + tick++ * 60_000));
}

async function feed(repo: InMemoryFeedRepository, n: number) {
  return repo.createFeed({
    clientId: "ws",
    tokenHash: `hash${n}`,
    tokenPrefix: `p${n}`,
    modelId: `model-${n}`,
    currencyCode: "USD",
    identifier: "clickId",
  });
}

describe("the model pricing a workspace's leads", () => {
  it("is the one frozen with the newest active feed", async () => {
    const repo = repository();
    const older = await feed(repo, 1);
    await repo.saveModel(older.id, { ...saved, modelId: "old" });
    const newer = await feed(repo, 2);
    await repo.saveModel(newer.id, { ...saved, modelId: "new" });

    const live = await liveModelFor(repo, "ws");
    expect(live.feedId).toBe(newer.id);
    expect(live.model?.modelId).toBe("new");
  });

  it("passes over a feed published without its model", async () => {
    const repo = repository();
    const priced = await feed(repo, 1);
    await repo.saveModel(priced.id, saved);
    await feed(repo, 2);

    const live = await liveModelFor(repo, "ws");
    expect(live.feedId).toBe(priced.id);
  });

  it("ignores a revoked feed and says why there is nothing", async () => {
    const repo = repository();
    const gone = await feed(repo, 1);
    await repo.saveModel(gone.id, saved);
    await repo.revokeFeed(gone.id);

    const live = await liveModelFor(repo, "ws");
    expect(live.model).toBeNull();
    expect(live.reason).toMatch(/published/);
  });

  it("never reads another workspace's model", async () => {
    const repo = repository();
    const theirs = await repo.createFeed({
      clientId: "someone-else",
      tokenHash: "h",
      tokenPrefix: "p",
      modelId: "m",
      currencyCode: "USD",
      identifier: "clickId",
    });
    await repo.saveModel(theirs.id, saved);
    expect((await liveModelFor(repo, "ws")).model).toBeNull();
  });
});
