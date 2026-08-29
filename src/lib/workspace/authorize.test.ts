import { describe, expect, it } from "vitest";
import { authorizeWorkspace, feedInWorkspace } from "./authorize";
import { InMemoryWorkspaceRepository } from "./repository";
import { generateWorkspaceKey, looksLikeFeedToken, looksLikeWorkspaceKey } from "./key";
import { InMemoryFeedRepository } from "@/lib/feed/repository";
import type { Workspace } from "./repository";

async function twoCustomers() {
  const repo = new InMemoryWorkspaceRepository();
  const a = await generateWorkspaceKey();
  const b = await generateWorkspaceKey();
  const northridge = await repo.create({ name: "Northridge", keyHash: a.keyHash, keyPrefix: a.keyPrefix });
  const acme = await repo.create({ name: "Acme", keyHash: b.keyHash, keyPrefix: b.keyPrefix });
  return { repo, northridge, acme, keyA: a.key, keyB: b.key };
}

async function feedFor(feeds: InMemoryFeedRepository, workspace: Workspace, hash: string) {
  return feeds.createFeed({
    clientId: workspace.id,
    tokenHash: hash,
    tokenPrefix: "vbb_live_aaaa",
    modelId: "model-1",
    currencyCode: "USD",
    identifier: "clickId",
  });
}

describe("authorizeWorkspace", () => {
  it("admits the right key", async () => {
    const { repo, keyA, northridge } = await twoCustomers();
    const result = await authorizeWorkspace(repo, keyA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.workspace.id).toBe(northridge.id);
  });

  it("refuses a key from another workspace's namespace", async () => {
    const { repo } = await twoCustomers();
    const stranger = await generateWorkspaceKey();
    const result = await authorizeWorkspace(repo, stranger.key);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("names the mistake when someone pastes their feed URL instead", async () => {
    const { repo } = await twoCustomers();
    // Both credentials arrive in the same email, so this is the likely error
    // and "not found" would send the customer looking in the wrong place.
    for (const wrong of [
      "vbb_live_4Z9Te1u1MNtHECjYhf2kYLnYMkBgQJal",
      "https://vbb-cyan.vercel.app/v1/feeds/google-ads/vbb_live_abc12345.csv",
    ]) {
      const result = await authorizeWorkspace(repo, wrong);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/feed URL|workspace key/i);
    }
  });

  it("asks for the key rather than failing blankly when none is sent", async () => {
    const { repo } = await twoCustomers();
    for (const empty of ["", "   ", undefined, null, 42]) {
      const result = await authorizeWorkspace(repo, empty);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/workspace key/i);
    }
  });

  it("refuses junk before it reaches the database", async () => {
    const { repo } = await twoCustomers();
    for (const junk of ["a paragraph of text", "vbb_ws_", "vbb_ws_short", "'; drop table workspaces;--"]) {
      const result = await authorizeWorkspace(repo, junk);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses a suspended workspace, and says it is suspended", async () => {
    const { repo, keyA, northridge } = await twoCustomers();
    await repo.suspend(northridge.id);
    const result = await authorizeWorkspace(repo, keyA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/suspended/i);
    }
  });
});

describe("feedInWorkspace - the isolation boundary", () => {
  it("admits a feed the workspace owns", async () => {
    const { northridge } = await twoCustomers();
    const feeds = new InMemoryFeedRepository();
    const feed = await feedFor(feeds, northridge, "a".repeat(64));

    const result = await feedInWorkspace(feeds, feed.id, northridge);
    expect(result.ok).toBe(true);
  });

  it("REFUSES ANOTHER CUSTOMER'S FEED, even with a valid key", async () => {
    const { northridge, acme } = await twoCustomers();
    const feeds = new InMemoryFeedRepository();
    const theirs = await feedFor(feeds, northridge, "a".repeat(64));
    await feedFor(feeds, acme, "b".repeat(64));

    // Acme's key is real and their workspace is active. It still must not
    // reach Northridge's feed - this is the whole boundary.
    const result = await feedInWorkspace(feeds, theirs.id, acme);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("answers the same for someone else's feed as for one that does not exist", async () => {
    const { northridge, acme } = await twoCustomers();
    const feeds = new InMemoryFeedRepository();
    const theirs = await feedFor(feeds, northridge, "a".repeat(64));

    const other = await feedInWorkspace(feeds, theirs.id, acme);
    const missing = await feedInWorkspace(feeds, "feed-does-not-exist", acme);

    // Identical answers, so a valid key cannot be used to discover which feed
    // ids exist.
    expect(other).toEqual(missing);
  });
});

describe("key shapes", () => {
  it("recognises a generated workspace key and rejects a feed token", async () => {
    const { key } = await generateWorkspaceKey();
    expect(looksLikeWorkspaceKey(key)).toBe(true);
    expect(looksLikeFeedToken(key)).toBe(false);
    expect(looksLikeFeedToken("vbb_live_abcdefgh")).toBe(true);
  });

  it("generates a distinct key every time", async () => {
    const keys = new Set(
      await Promise.all(Array.from({ length: 50 }, async () => (await generateWorkspaceKey()).key))
    );
    expect(keys.size).toBe(50);
  });

  it("stores only a hash - the key itself is never derivable from it", async () => {
    const { key, keyHash, keyPrefix } = await generateWorkspaceKey();
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).not.toContain(key);
    // The prefix identifies a workspace in a list and cannot be used as a key.
    expect(looksLikeWorkspaceKey(keyPrefix)).toBe(false);
  });
});
