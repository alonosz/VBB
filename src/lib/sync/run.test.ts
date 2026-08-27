import { describe, expect, it } from "vitest";
import { runSync } from "./run";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { saveValueModel, type SavedValueModel } from "@/lib/model/savedModel";
import { valueAllLeads, withOverrides } from "@/lib/analysis/valueModel";
import { savedModelToValueModel } from "@/lib/model/savedModel";
import type { FeedRecord } from "@/lib/feed/types";
import type { MappedDeal } from "@/lib/analysis/types";
import { gateStatusFor } from "@/lib/analysis/gateValue";
import { savedGateToGateValue } from "@/lib/model/savedModel";

const NOW = new Date("2026-06-15T12:00:00Z");

function fixture(now = NOW) {
  const deals = generateDemoDeals();
  const result = runDiagnostic({ deals, excluded: [], currencyCode: "USD", now });
  const applied = withOverrides(result.valueModel, deals, {});
  const model = saveValueModel(applied, { deals, modelId: "model-1", gate: result.gate, now });
  return { deals, model, applied, result };
}


/**
 * What a row's value must be, computed independently of the pipeline: the
 * day-0 price, times the gate only when it fired soon enough for Google to act
 * on it. Loose bounds here would let real drift through, so this is exact.
 */
function expectedValues(deals: MappedDeal[], model: SavedValueModel, now: Date) {
  const gate = savedGateToGateValue(model);
  const out = new Map<string, number>();
  for (const lead of valueAllLeads(deals, savedModelToValueModel(model))) {
    const clickId = lead.deal.clickId?.trim();
    if (!clickId || !(lead.value > 0) || !lead.deal.createdAt) continue;
    let value = lead.value;
    if (gate?.multiplier) {
      const status = gateStatusFor(lead.deal, gate.stage, now);
      if (status.reached && status.inTime) {
        value = Math.round(value * gate.multiplier * 100) / 100;
      }
    }
    out.set(clickId, value);
  }
  return out;
}

async function feedFor(repo: InMemoryFeedRepository, model: SavedValueModel): Promise<FeedRecord> {
  return repo.createFeed({
    tokenHash: "a".repeat(64),
    tokenPrefix: "vbb_live_8f2a",
    modelId: model.modelId,
    currencyCode: model.currencyCode,
    identifier: "clickId",
  });
}

describe("runSync", () => {
  it("prices and publishes a first run", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    const report = await runSync({ repo, feed, model, deals, now: NOW });

    expect(report.refusedBecause).toBeNull();
    expect(report.dealsPulled).toBe(deals.length);
    expect(report.rowsAdded).toBeGreaterThan(0);
    expect(report.newConversions).toBe(report.rowsAdded);
    expect(report.adjustments).toBe(0);
  });

  it("sends nothing new on a second run over the same data", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    await runSync({ repo, feed, model, deals, now: NOW });
    const second = await runSync({ repo, feed, model, deals, now: NOW });

    // The whole point of a nightly job: running it twice must not tell Google
    // the same conversion happened twice.
    expect(second.rowsAdded).toBe(0);
    expect(second.newConversions).toBe(0);
  });

  it("writes the value the model actually predicts, lead by lead", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    await runSync({ repo, feed, model, deals, now: NOW });
    const stored = await repo.rowsFor(feed.id);
    expect(stored.length).toBeGreaterThan(0);

    // Recompute independently and match row for row, keyed by click ID. A
    // stored value that drifted from what the frozen model says is the whole
    // failure this pipeline exists to avoid.
    const expected = expectedValues(deals, model, NOW);

    let checked = 0;
    for (const row of stored) {
      const want = expected.get(row.clickId!);
      expect(want, `no expected value for ${row.clickId}`).toBeDefined();
      expect(row.value).toBe(want);
      checked++;
    }
    // Only leads carrying a click ID become rows on a clickId feed, so this is
    // a fraction of the file rather than all of it.
    expect(checked).toBe(stored.length);
    expect(checked).toBeGreaterThan(50);
  });

  it("refuses a currency the model was not fitted in", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    const report = await runSync({
      repo, feed, model, deals, reportingCurrency: "EUR", now: NOW,
    });

    expect(report.refusedBecause).toMatch(/USD.*EUR|EUR.*USD/);
    expect(report.rowsAdded).toBe(0);
    expect(await repo.rowsFor(feed.id)).toHaveLength(0);
  });

  it("refuses a revoked feed", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);
    await repo.revokeFeed(feed.id);

    const report = await runSync({
      repo, feed: { ...feed, status: "revoked" }, model, deals, now: NOW,
    });
    expect(report.refusedBecause).toMatch(/revoked/i);
    expect(report.rowsAdded).toBe(0);
  });

  it("refuses when the CRM stopped supplying the columns the model needs", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    // Same leads, none of the attributes the model was fitted on. Pricing these
    // would send Google one flat number for everybody and call it a model.
    const stripped: MappedDeal[] = deals.map((d) => ({
      ...d, email: null, employeeCount: null, industry: null, contactTitle: null, signals: {},
    }));

    const report = await runSync({ repo, feed, model, deals: stripped, now: NOW });
    expect(report.refusedBecause).toMatch(/none of this model's rules match/i);
    expect(await repo.rowsFor(feed.id)).toHaveLength(0);
  });

  it("keeps the feed's identifier rather than re-picking it per run", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    await runSync({ repo, feed, model, deals, now: NOW });
    // Google's import carries one identifier type per file. Every row has to
    // match what the feed was published as, whatever today's pull looks like.
    for (const row of await repo.rowsFor(feed.id)) {
      expect(row.clickId).not.toBeNull();
      expect(row.hashedEmail).toBeNull();
    }
  });

  it("never refits — it prices on the saved multipliers, not today's data", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { deals, model } = fixture();
    const feed = await feedFor(repo, model);

    const saved = model.factors.find((f) => f.key === "industry")!;
    const savedManufacturing = saved.levels.find((l) => l.level === "Manufacturing")!.multiplier;
    expect(savedManufacturing).toBeGreaterThan(1.3);

    // Every lead is now Manufacturing. A refit on this data would find
    // Manufacturing to be the baseline and collapse its multiplier toward 1.
    const shifted = deals.map((d) => ({ ...d, industry: "Manufacturing" }));
    const refitted = runDiagnostic({ deals: shifted, excluded: [], currencyCode: "USD", now: NOW });
    const refitIndustry = refitted.valueModel.includedFactors.find((f) => f.key === "industry");
    const refitManufacturing =
      refitIndustry?.levels.find((l) => l.level === "Manufacturing")?.lift ?? 1;
    // The two genuinely disagree, or this test proves nothing.
    expect(Math.abs(refitManufacturing - savedManufacturing)).toBeGreaterThan(0.2);

    await runSync({ repo, feed, model, deals: shifted, now: NOW });
    const stored = await repo.rowsFor(feed.id);

    const bySaved = expectedValues(shifted, model, NOW);
    expect(stored.length).toBeGreaterThan(50);
    for (const row of stored) {
      expect(row.value).toBe(bySaved.get(row.clickId!));
    }

    // And the sync writes rows only — it must never quietly save a new model.
    expect((await repo.modelFor(feed.id)).model).toBeNull();
  });

  it("carries the frozen gate, so a scheduled run can still sharpen a value", async () => {
    const { model } = fixture();
    // The gate has to survive saving, or a scheduled run would have to refit to
    // find one — which is the thing principle 8 forbids.
    expect(model.gate).toBeTruthy();
    expect(model.gate!.multiplier).toBeGreaterThan(1);
    expect(model.gate!.stage).toBeTruthy();
  });
});
