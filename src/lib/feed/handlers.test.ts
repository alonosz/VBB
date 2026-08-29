import { describe, expect, it } from "vitest";
import { publishFeed, serveFeed, feedStatus, CONVERSION_NAME } from "./handlers";
import { tokenFromInput } from "./token";
import { InMemoryFeedRepository } from "./repository";
import {
  loadSavedModel,
  savedModelToValueModel,
  saveValueModel,
} from "@/lib/model/savedModel";
import { generateDemoDeals } from "@/lib/fixtures/demoDataset";
import { runDiagnostic } from "@/lib/analysis";
import { valueAllLeads, withOverrides } from "@/lib/analysis/valueModel";
import { tokenFromFilename, tokenFromBasicAuth } from "@/app/v1/feeds/google-ads/[file]/route";
import { isPublishableKey } from "./supabaseRepository";
import { MAX_FETCHES_PER_DAY } from "./rateLimit";
import { buildFeedRows } from "./publish";
import type { ValuedLead } from "@/lib/analysis/valueModel";
import type { MappedDeal } from "@/lib/analysis/types";

const WORKSPACE = "ws-1";
const NOW = new Date("2026-06-15T12:00:00Z");
const ORIGIN = "https://valuebasedbidding.com";

function lead(id: string, value: number, clickId: string): ValuedLead {
  const deal: MappedDeal = {
    id, createdAt: new Date("2026-06-14T09:07:05Z"), closedAt: null, outcome: "open",
    amount: null, stage: null, source: "Paid Search", email: null, clickId,
  };
  return {
    deal, steps: [], stackMultiplier: 1, boundedMultiplier: 1,
    wasBounded: false, rawValue: value, value, cappedFrom: null,
  };
}

async function publishedFeed(repo: InMemoryFeedRepository, count = 2) {
  const leads = Array.from({ length: count }, (_, i) =>
    lead(`${i}`, 100 * (i + 1), `Cj0${"a".repeat(9)}${i}`)
  );
  const { rows } = await buildFeedRows({
    leads, modelId: "model-1", currencyCode: "USD", identifier: "clickId", now: NOW,
  });
  const res = await publishFeed(
    repo,
    {
      modelId: "model-1",
      currencyCode: "USD",
      identifier: "clickId",
      rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
    },
    ORIGIN,
    WORKSPACE
  );
  return { res, body: JSON.parse(res.body) as Record<string, string | number> };
}


/** A minimal SavedValueModel, shaped like what saveValueModel() produces. */
function savedModel(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    modelId: "model-1",
    fittedAt: "2026-06-01T00:00:00.000Z",
    fittedOn: 317,
    window: { from: "2026-01-01", to: "2026-06-01" },
    currencyCode: "USD",
    baseValue: 1993.73,
    calibrationFactor: 0.613169,
    cap: 21150,
    factors: [
      {
        key: "industry",
        label: "Industry",
        levels: [
          { level: "Manufacturing", multiplier: 1.641, sampleSize: 121, closeRate: 0.322, medianWonAmount: 6800 },
          { level: "Retail", multiplier: 0.69, sampleSize: 55, closeRate: 0.2, medianWonAmount: 3450 },
        ],
      },
    ],
    customSignalKeys: [],
    claims: [],
    ...over,
  };
}

async function publishWithModel(
  repo: InMemoryFeedRepository,
  model: unknown
) {
  const { rows } = await buildFeedRows({
    leads: [lead("0", 100, `Cj0${"a".repeat(9)}0`)],
    modelId: "model-1", currencyCode: "USD", identifier: "clickId", now: NOW,
  });
  const res = await publishFeed(
    repo,
    {
      modelId: "model-1",
      currencyCode: "USD",
      identifier: "clickId",
      rows: rows.map((r) => ({ ...r, conversionTime: r.conversionTime.toISOString() })),
      model,
    },
    ORIGIN,
    WORKSPACE
  );
  return { res, body: JSON.parse(res.body) as Record<string, unknown> };
}

function tokenFrom(feedUrl: string): string {
  return new URL(feedUrl).pathname.split("/").pop()!.replace(/\.csv$/, "");
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

describe("publishFeed", () => {
  it("returns a usable URL and says how many rows went in", async () => {
    const { res, body } = await publishedFeed(new InMemoryFeedRepository());
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Google validates the file extension off the end of the URL, so the feed
    // URL has to finish in .csv rather than a query string.
    expect(String(body.feedUrl)).toMatch(
      /^https:\/\/valuebasedbidding\.com\/v1\/feeds\/google-ads\/vbb_live_[A-Za-z0-9]+\.csv$/
    );
    expect(body.rowsPublished).toBe(2);
  });

  it("hands the token back exactly once and stores only its hash", async () => {
    const repo = new InMemoryFeedRepository();
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(String(body.feedUrl));
    // The prefix is all that is kept in a form anyone can read back.
    expect(token.startsWith(String(body.tokenPrefix))).toBe(true);
    expect(String(body.tokenPrefix).length).toBeLessThan(token.length / 2);
  });

  it("refuses a row carrying an unhashed email address", async () => {
    const res = await publishFeed(
      new InMemoryFeedRepository(),
      {
        modelId: "m", currencyCode: "USD", identifier: "email",
        rows: [{
          hashedEmail: "alice@example.com", conversionTime: NOW.toISOString(),
          value: 100, rowKey: "k1",
        }],
      },
      ORIGIN,
      WORKSPACE
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/SHA-256/);
  });

  it("refuses a row with no identifier", async () => {
    const res = await publishFeed(
      new InMemoryFeedRepository(),
      {
        modelId: "m", currencyCode: "USD",
        rows: [{ conversionTime: NOW.toISOString(), value: 100, rowKey: "k1" }],
      },
      ORIGIN,
      WORKSPACE
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/hashed email or a click ID/);
  });

  it("refuses a feed with no currency, rather than guessing one", async () => {
    const res = await publishFeed(
      new InMemoryFeedRepository(),
      { modelId: "m", rows: [] },
      ORIGIN,
      WORKSPACE
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/currency/);
  });

  it("refuses a feed that would say nothing", async () => {
    const res = await publishFeed(
      new InMemoryFeedRepository(),
      { modelId: "m", currencyCode: "USD", rows: [] },
      ORIGIN,
      WORKSPACE
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/no leads to publish/);
  });

  it("stamps every row with the feed's currency and model, so a feed cannot mix them", async () => {
    const repo = new InMemoryFeedRepository();
    const res = await publishFeed(
      repo,
      {
        modelId: "model-1", currencyCode: "USD", identifier: "clickId",
        rows: [{
          clickId: "Cj0aaaaaaaaa", conversionTime: NOW.toISOString(), value: 100,
          rowKey: "k1", currencyCode: "EUR", modelId: "someone-elses-model",
        }],
      },
      ORIGIN,
      WORKSPACE
    );
    const feedId = String(JSON.parse(res.body).feedId);
    const stored = await repo.rowsFor(feedId);
    expect(stored[0].currencyCode).toBe("USD");
    expect(stored[0].modelId).toBe("model-1");
  });
});

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

describe("serveFeed", () => {
  const ctx = { userAgent: "Google-Ads-Conversion-Upload", ip: "203.0.113.7", now: NOW };

  it("serves the CSV Google expects", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const res = await serveFeed(repo, { ...ctx, token: tokenFrom(String(body.feedUrl)) });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.split(/\r?\n/)[0]).toBe(
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency"
    );
    expect(res.body).toContain(CONVERSION_NAME);
    expect(res.body.trim().split(/\r?\n/)).toHaveLength(3);
  });

  it("answers a wrong token exactly as it answers no token", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    await publishedFeed(repo);
    const wrong = await serveFeed(repo, { ...ctx, token: "vbb_live_totallywrong" });
    const missing = await serveFeed(repo, { ...ctx, token: null });
    expect(wrong).toEqual(missing);
    expect(wrong.status).toBe(404);
  });

  it("answers a revoked feed as though it never existed", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    await repo.revokeFeed(String(body.feedId));
    const res = await serveFeed(repo, { ...ctx, token: tokenFrom(String(body.feedUrl)) });
    expect(res.status).toBe(404);
    // Confirming a token was once real is still confirming a token.
    expect(res.body).toBe("Not found\n");
  });

  it("logs every fetch, with the IP hashed", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    await serveFeed(repo, { ...ctx, token: tokenFrom(String(body.feedUrl)) });

    expect(repo.log).toHaveLength(1);
    expect(repo.log[0].entry.status).toBe(200);
    expect(repo.log[0].entry.rowCount).toBe(2);
    expect(repo.log[0].entry.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(repo.log)).not.toContain("203.0.113");
  });

  it("does not log a fetch nobody was authorized to make", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    await publishedFeed(repo);
    await serveFeed(repo, { ...ctx, token: "vbb_live_wrong" });
    // Nothing to attribute it to, and logging it would let a prober fill the
    // log of a feed they cannot read.
    expect(repo.log).toHaveLength(0);
  });

  it("cuts a caller off past the daily limit", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(String(body.feedUrl));

    for (let i = 0; i < MAX_FETCHES_PER_DAY; i++) {
      expect((await serveFeed(repo, { ...ctx, token })).status).toBe(200);
    }
    const blocked = await serveFeed(repo, { ...ctx, token });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
    expect(blocked.body).toMatch(/above its limit/);
  });

  it("logs the refusal too, so a run of them is visible", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(String(body.feedUrl));
    for (let i = 0; i < MAX_FETCHES_PER_DAY + 1; i++) {
      await serveFeed(repo, { ...ctx, token });
    }
    expect(repo.log.filter((l) => l.entry.status === 429)).toHaveLength(1);
  });

  it("lets the caller back in once the window has moved on", async () => {
    let clock = NOW;
    const repo = new InMemoryFeedRepository(() => clock);
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(String(body.feedUrl));

    for (let i = 0; i < MAX_FETCHES_PER_DAY; i++) {
      await serveFeed(repo, { ...ctx, token, now: clock });
    }
    expect((await serveFeed(repo, { ...ctx, token, now: clock })).status).toBe(429);

    clock = new Date(NOW.getTime() + 25 * 3_600_000);
    expect((await serveFeed(repo, { ...ctx, token, now: clock })).status).toBe(200);
  });

  it("never serves anything that looks like a contact detail", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const res = await serveFeed(repo, { ...ctx, token: tokenFrom(String(body.feedUrl)) });
    expect(res.body).not.toMatch(/@/);
  });
});

// ---------------------------------------------------------------------------
// The wrong key is the easy mistake
// ---------------------------------------------------------------------------

describe("isPublishableKey", () => {
  it("spots the new publishable key", () => {
    expect(isPublishableKey("sb_publishable_OIEstuz21ouO3LbYwyvZ8g_RjePq9yv")).toBe(true);
  });

  it("spots a legacy anon JWT by its role claim", () => {
    const jwt = (role: string) =>
      `header.${Buffer.from(JSON.stringify({ role })).toString("base64")}.sig`;
    expect(isPublishableKey(jwt("anon"))).toBe(true);
    expect(isPublishableKey(jwt("service_role"))).toBe(false);
  });

  it("lets a real secret key through", () => {
    expect(isPublishableKey("sb_secret_exampleexampleexample")).toBe(false);
  });

  it("does not choke on something that is not a key at all", () => {
    expect(isPublishableKey("")).toBe(false);
    expect(isPublishableKey("not.a.jwt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The shapes Google Ads actually accepts
// ---------------------------------------------------------------------------

describe("reading the token off a Google Ads request", () => {
  it("takes it from the filename, extension stripped", () => {
    expect(tokenFromFilename("vbb_live_abc123.csv")).toBe("vbb_live_abc123");
    expect(tokenFromFilename("vbb_live_abc123.CSV")).toBe("vbb_live_abc123");
    expect(tokenFromFilename("vbb_live_abc123.tsv")).toBe("vbb_live_abc123");
  });

  it("copes with a filename that carries no extension", () => {
    expect(tokenFromFilename("vbb_live_abc123")).toBe("vbb_live_abc123");
  });

  it("refuses an empty filename rather than treating it as a token", () => {
    expect(tokenFromFilename(".csv")).toBeNull();
    expect(tokenFromFilename("")).toBeNull();
  });

  it("takes it from the password Google's form asks for", () => {
    // Google's HTTPS source requires a username and password; the token is
    // accepted there so it need not sit in the URL.
    const header = "Basic " + Buffer.from("anyone:vbb_live_abc123").toString("base64");
    expect(tokenFromBasicAuth(header)).toBe("vbb_live_abc123");
  });

  it("keeps a password containing a colon intact", () => {
    const header = "Basic " + Buffer.from("user:pa:ss:word").toString("base64");
    expect(tokenFromBasicAuth(header)).toBe("pa:ss:word");
  });

  it("ignores anything that is not Basic auth", () => {
    expect(tokenFromBasicAuth(null)).toBeNull();
    expect(tokenFromBasicAuth("Bearer abc")).toBeNull();
    expect(tokenFromBasicAuth("Basic !!!not-base64!!!")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The saved model, so a scheduled run can price without a browser
// ---------------------------------------------------------------------------

describe("publishing the model that priced the rows", () => {
  it("stores it, and reads it back through the validator", async () => {
    const repo = new InMemoryFeedRepository();
    const { body } = await publishWithModel(repo, savedModel());
    expect(body.modelStored).toBe(true);

    const loaded = await repo.modelFor(body.feedId as string);
    expect(loaded.error).toBeNull();
    expect(loaded.model?.modelId).toBe("model-1");
    expect(loaded.model?.baseValue).toBe(1993.73);
    // Provenance survives the round trip - a multiplier stays explainable.
    expect(loaded.model?.factors[0].levels[0]).toMatchObject({
      level: "Manufacturing",
      multiplier: 1.641,
      sampleSize: 121,
    });
  });

  it("publishes without one, and says the feed cannot refresh itself", async () => {
    const repo = new InMemoryFeedRepository();
    const { res, body } = await publishedFeed(repo);
    expect(res.status).toBe(200);
    expect(body.modelStored).toBe(false);

    const loaded = await repo.modelFor(body.feedId as string);
    expect(loaded.model).toBeNull();
    expect(loaded.error).toBe("This feed has no saved model.");
  });

  it("refuses a model that priced under a different id", async () => {
    const { res, body } = await publishWithModel(
      new InMemoryFeedRepository(),
      savedModel({ modelId: "some-other-model" })
    );
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/does not match/i);
  });

  it("refuses a model fitted in another currency", async () => {
    const { res, body } = await publishWithModel(
      new InMemoryFeedRepository(),
      savedModel({ currencyCode: "EUR" })
    );
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/EUR.*USD/);
  });

  it("refuses a model with no base value rather than pricing leads at zero", async () => {
    const { res, body } = await publishWithModel(
      new InMemoryFeedRepository(),
      savedModel({ baseValue: 0 })
    );
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/base value/i);
  });

  it("refuses a contact detail smuggled into a level label", async () => {
    const repo = new InMemoryFeedRepository();
    const model = savedModel({
      factors: [
        {
          key: "seniority",
          label: "Seniority",
          levels: [
            { level: "dana.k@northridgefab.com", multiplier: 1.2, sampleSize: 30, closeRate: 0.3, medianWonAmount: 5000 },
          ],
        },
      ],
    });
    // It parses fine - it is only a string. The storage guard is what refuses
    // it, exactly as the database would.
    const { body } = await publishWithModel(repo, model);
    expect(body.modelStored).toBe(false);
    expect(await repo.modelFor(body.feedId as string)).toMatchObject({ model: null });
  });

  it("a refit replaces the stored model rather than stacking another", async () => {
    const repo = new InMemoryFeedRepository();
    const { body } = await publishWithModel(repo, savedModel());
    const feedId = body.feedId as string;

    const refit = loadSavedModel(savedModel({ baseValue: 2400 })).model!;
    await repo.saveModel(feedId, refit);

    const loaded = await repo.modelFor(feedId);
    expect(loaded.model?.baseValue).toBe(2400);
  });
});

// ---------------------------------------------------------------------------
// The round trip that the nightly sync will depend on
// ---------------------------------------------------------------------------

describe("a real fitted model, stored and re-applied", () => {
  it("survives the round trip and prices every lead identically", async () => {
    const deals = generateDemoDeals();
    const result = runDiagnostic({ deals, excluded: [], currencyCode: "USD" });
    const applied = withOverrides(result.valueModel, deals, {});
    const artifact = saveValueModel(applied, { deals, modelId: "model-1" });

    // A model fitted on real-shaped data has to be storable as it comes out of
    // the fitter. A fixture proves the plumbing; this proves the product.
    const repo = new InMemoryFeedRepository();
    const { res, body } = await publishWithModel(repo, artifact);
    expect(res.status).toBe(200);
    expect(body.modelStored).toBe(true);

    const reloaded = await repo.modelFor(body.feedId as string);
    expect(reloaded.error).toBeNull();

    // The guarantee a scheduled run rests on: the same lead prices the same
    // whether it goes through the model on screen or the one read back out of
    // storage. If these ever diverge, Google learns from a moving target.
    const before = valueAllLeads(deals, applied).map((v) => v.value);
    const after = valueAllLeads(deals, savedModelToValueModel(reloaded.model!)).map((v) => v.value);
    expect(after).toEqual(before);
  });

  it("carries the provenance that makes each multiplier explainable", async () => {
    const deals = generateDemoDeals();
    const result = runDiagnostic({ deals, excluded: [], currencyCode: "USD" });
    const artifact = saveValueModel(withOverrides(result.valueModel, deals, {}), {
      deals,
      modelId: "model-1",
    });

    const repo = new InMemoryFeedRepository();
    const { body } = await publishWithModel(repo, artifact);
    const reloaded = await repo.modelFor(body.feedId as string);

    const industry = reloaded.model!.factors.find((f) => f.key === "industry");
    expect(industry).toBeDefined();
    for (const level of industry!.levels) {
      // Sample size and close rate are what turn a bare number into a sentence
      // an advertiser can argue with, so they have to survive storage too.
      expect(level.sampleSize).toBeGreaterThanOrEqual(25);
      expect(level.closeRate).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Has Google actually collected it?
// ---------------------------------------------------------------------------

describe("tokenFromInput", () => {
  it("takes the whole feed URL, which is what people paste", () => {
    expect(tokenFromInput("https://valuebasedbidding.com/v1/feeds/google-ads/vbb_live_abc123def.csv"))
      .toBe("vbb_live_abc123def");
  });

  it("takes a bare token, trailing slash, or stray whitespace", () => {
    expect(tokenFromInput("  vbb_live_abc123def  ")).toBe("vbb_live_abc123def");
    expect(tokenFromInput("https://x.com/v1/feeds/google-ads/vbb_live_abc123def.csv/")).toBe(
      "vbb_live_abc123def"
    );
  });

  it("refuses anything that is not a plausible token", () => {
    expect(tokenFromInput("")).toBeNull();
    expect(tokenFromInput("short")).toBeNull();
    expect(tokenFromInput("not a url at all, just a sentence")).toBeNull();
    expect(tokenFromInput("https://valuebasedbidding.com/")).toBeNull();
  });
});

describe("feedStatus", () => {
  it("says Google has not collected it yet, and that waiting is normal", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const res = await feedStatus(repo, tokenFrom(body.feedUrl as string), NOW);
    const { status } = JSON.parse(res.body);

    expect(status.verdict).toBe("never-fetched");
    expect(status.message).toMatch(/hasn't collected/i);
    expect(status.lastSuccessAt).toBeNull();
  });

  it("reports the last successful collection in hours and rows", async () => {
    let clock = new Date("2026-06-15T06:00:00Z");
    const repo = new InMemoryFeedRepository(() => clock);
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(body.feedUrl as string);

    await serveFeed(repo, { token, ip: "203.0.113.7", userAgent: "Google-Ads", now: clock });

    clock = new Date("2026-06-15T12:00:00Z");
    const res = await feedStatus(repo, token, clock);
    const { status } = JSON.parse(res.body);

    expect(status.verdict).toBe("collecting");
    expect(status.message).toMatch(/6 hours ago/);
    expect(status.message).toMatch(/took 2 rows/);
    expect(status.fetches[0].status).toBe(200);
  });

  it("says so when every attempt has failed", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(body.feedUrl as string);
    const feedId = body.feedId as string;

    for (let i = 0; i < 3; i++) {
      await repo.logFetch(feedId, { status: 429, rowCount: 0, userAgent: null, ipHash: null });
    }

    const res = await feedStatus(repo, token, NOW);
    const { status } = JSON.parse(res.body);
    expect(status.verdict).toBe("failing");
    expect(status.message).toMatch(/3 times/);
  });

  it("checking status is not a fetch - it must not spend the rate limit", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    const token = tokenFrom(body.feedUrl as string);

    for (let i = 0; i < 5; i++) await feedStatus(repo, token, NOW);

    // Nothing logged, so nothing counted against the budget Google needs.
    expect(await repo.countFetchesSince(body.feedId as string, new Date(0))).toBe(0);
  });

  it("a wrong key does not reveal whether a feed exists", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    await publishedFeed(repo);
    const res = await feedStatus(repo, "vbb_live_wrongkey123", NOW);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/no feed found/i);
  });

  it("says a revoked feed can no longer be collected from", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const { body } = await publishedFeed(repo);
    await repo.revokeFeed(body.feedId as string);

    const res = await feedStatus(repo, tokenFrom(body.feedUrl as string), NOW);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/revoked/i);
  });
});
