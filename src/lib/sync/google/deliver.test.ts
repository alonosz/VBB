import { describe, expect, it } from "vitest";
import { deliverPending, googleSenderFor } from "./deliver";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import type { FeedRow } from "@/lib/feed/types";
import { fakeSupabase } from "../fakeSupabase";
import { CrmConnectionStore } from "../connections";
import { generateKey, parseKey } from "../secrets";
import type { AdsClient } from "./client";

const KEY = parseKey(generateKey())!;
const NOW = new Date("2026-09-10T15:00:00Z");

function row(rowKey: string): FeedRow {
  return {
    hashedEmail: null, clickId: `Cj0KCQ${rowKey}example0`, conversionTime: NOW,
    value: 90, currencyCode: "USD", modelId: "model-1", kind: "conversion", rowKey,
  };
}

async function apiFeed(repo: InMemoryFeedRepository) {
  const feed = await repo.createFeed({
    clientId: "ws-1", tokenHash: "c".repeat(64), tokenPrefix: "vbb_live_c",
    modelId: "model-1", currencyCode: "USD", identifier: "clickId", delivery: "api",
  });
  await repo.addRows(feed.id, [row("k1"), row("k2")]);
  return feed;
}

describe("deliverPending", () => {
  it("sends every waiting row once and marks it delivered", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const feed = await apiFeed(repo);
    const sent: FeedRow[][] = [];

    const first = await deliverPending({ feed, repo, sender: { send: async (r) => { sent.push(r); } }, now: NOW });
    const second = await deliverPending({ feed, repo, sender: { send: async (r) => { sent.push(r); } }, now: NOW });

    expect(first).toEqual({ sent: 2, pending: 0, failed: 0, error: null });
    expect(second).toEqual({ sent: 0, pending: 0, failed: 0, error: null });
    expect(sent).toHaveLength(1);
    expect(repo.deliveredAt(feed.id, "k1")).toEqual(NOW);
  });

  it("leaves rows pending when Google refuses, so the next run retries", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const feed = await apiFeed(repo);

    const out = await deliverPending({
      feed, repo, sender: { send: async () => { throw new Error("Google said no."); } },
    });

    expect(out).toMatchObject({ sent: 0, pending: 2, failed: 2 });
    expect(out.error).toMatch(/2 rows refused by Google: Google said no/);
    // Named as refused: skipped by the live path, kept for the night.
    expect(await repo.pendingRows(feed.id)).toHaveLength(0);
    expect(await repo.pendingRows(feed.id, { retryFailed: true })).toHaveLength(2);
    expect(await repo.countPending(feed.id)).toBe(2);
  });

  it("isolates a row Google refuses so the rest still go, and names it", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const feed = await apiFeed(repo);
    // The batch fails while k2 is in it; each row alone tells which one Google objects to.
    const sender = {
      send: async (rows: FeedRow[]) => {
        if (rows.some((r) => r.rowKey === "k2")) throw new Error("Click not found.");
      },
    };

    const first = await deliverPending({ feed, repo, sender, now: NOW });
    expect(first).toMatchObject({ sent: 1, failed: 1, pending: 1 });
    expect(first.error).toMatch(/1 row refused by Google: Click not found/);
    expect(repo.deliveredAt(feed.id, "k1")).toEqual(NOW);
    expect(repo.failureOf(feed.id, "k2")).toBe("Click not found.");

    // The live path leaves a refused row alone; the night tries it again.
    let calls = 0;
    const counting = { send: async () => { calls++; } };
    const live = await deliverPending({ feed, repo, sender: counting, now: NOW });
    expect(calls).toBe(0);
    expect(live).toMatchObject({ sent: 0, pending: 1 });
    const night = await deliverPending({ feed, repo, sender: counting, now: NOW, retryFailed: true });
    expect(night).toMatchObject({ sent: 1, pending: 0, failed: 0, error: null });
    expect(repo.failureOf(feed.id, "k2")).toBeNull();
  });

  it("never sends a url feed", async () => {
    const repo = new InMemoryFeedRepository(() => NOW);
    const feed = await repo.createFeed({
      clientId: "ws-1", tokenHash: "d".repeat(64), tokenPrefix: "vbb_live_d",
      modelId: "model-1", currencyCode: "USD", identifier: "clickId",
    });
    await repo.addRows(feed.id, [row("k1")]);
    let calls = 0;
    const out = await deliverPending({ feed, repo, sender: { send: async () => { calls++; } } });
    expect(out.sent).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("googleSenderFor", () => {
  it("refuses when no account has been chosen from the Connect step", async () => {
    const { client } = fakeSupabase();
    const connections = new CrmConnectionStore(client, KEY);
    await connections.save({ workspaceId: "ws-1", provider: "google_ads", accessToken: "t", externalAccountId: null });

    const { sender, error } = await googleSenderFor({ workspaceId: "ws-1", connections, oauth: null });
    expect(sender).toBeNull();
    expect(error).toMatch(/Connect step/);
  });

  it("sends against the remembered account and its conversion action", async () => {
    const { client } = fakeSupabase();
    const connections = new CrmConnectionStore(client, KEY);
    await connections.save({
      workspaceId: "ws-1", provider: "google_ads", accessToken: "tok", externalAccountId: "1234567890",
      expiresAt: new Date(NOW.getTime() + 3_600_000),
    });
    const calls: unknown[] = [];

    const { sender, error } = await googleSenderFor({
      workspaceId: "ws-1", connections, oauth: null, now: NOW,
      deps: {
        credentials: (accessToken) => ({ accessToken, developerToken: "dev", loginCustomerId: null }),
        makeClient: () => ({}) as AdsClient,
        resolveActionId: async () => "555",
        ingest: async (call) => { calls.push(call); return { requestId: "r1", fieldWarnings: [] }; },
      },
    });

    expect(error).toBeNull();
    await sender!.send([row("k1")]);
    expect(calls[0]).toMatchObject({ accessToken: "tok", operatingAccountId: "1234567890", conversionActionId: "555" });
  });
});
