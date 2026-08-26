import { describe, expect, it } from "vitest";
import { publishFeed, serveFeed, CONVERSION_NAME } from "./handlers";
import { InMemoryFeedRepository } from "./repository";
import { isPublishableKey } from "./supabaseRepository";
import { MAX_FETCHES_PER_DAY } from "./rateLimit";
import { buildFeedRows } from "./publish";
import type { ValuedLead } from "@/lib/analysis/valueModel";
import type { MappedDeal } from "@/lib/analysis/types";

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
    ORIGIN
  );
  return { res, body: JSON.parse(res.body) as Record<string, string | number> };
}

function tokenFrom(feedUrl: string): string {
  return new URL(feedUrl).searchParams.get("key")!;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

describe("publishFeed", () => {
  it("returns a usable URL and says how many rows went in", async () => {
    const { res, body } = await publishedFeed(new InMemoryFeedRepository());
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(String(body.feedUrl)).toMatch(
      /^https:\/\/valuebasedbidding\.com\/v1\/feeds\/google-ads\?key=vbb_live_/
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
      ORIGIN
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
      ORIGIN
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/hashed email or a click ID/);
  });

  it("refuses a feed with no currency, rather than guessing one", async () => {
    const res = await publishFeed(
      new InMemoryFeedRepository(),
      { modelId: "m", rows: [] },
      ORIGIN
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/currency/);
  });

  it("refuses a feed that would say nothing", async () => {
    const res = await publishFeed(
      new InMemoryFeedRepository(),
      { modelId: "m", currencyCode: "USD", rows: [] },
      ORIGIN
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
      ORIGIN
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
