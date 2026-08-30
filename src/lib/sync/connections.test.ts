import { describe, expect, it } from "vitest";
import { CrmConnectionStore } from "./connections";
import { fakeSupabase } from "./fakeSupabase";
import { generateKey, parseKey } from "./secrets";

const KEY = parseKey(generateKey())!;
// The store is keyed on a workspace now; the constant is that id.
const FEED = "feed-1";
const TOKEN = "crm-token-placeholder-not-a-real-credential";
const REFRESH = "refresh-9a8b7c6d";

describe("CrmConnectionStore", () => {
  it("stores a token only in encrypted form", async () => {
    const { client, rows, rowFor } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);

    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN, refreshToken: REFRESH });

    const written = JSON.stringify(rowFor(FEED));
    // The promise, checked against what actually reached the row.
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(REFRESH);
    expect(written).not.toContain("crm-token-placeholder");
    expect(rowFor(FEED)!.access_token).toMatch(/^v1\./);
    expect(rowFor(FEED)!.refresh_token).toMatch(/^v1\./);
  });

  it("gives the plaintext back on load", async () => {
    const { client, rowFor } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({
      workspaceId: FEED, provider: "hubspot", accessToken: TOKEN, refreshToken: REFRESH,
      externalAccountId: "portal-42", scopes: "crm.objects.deals.read",
    });

    const { connection, error } = await store.load(FEED, "hubspot");
    expect(error).toBeNull();
    expect(connection).toMatchObject({
      workspaceId: FEED,
      accessToken: TOKEN,
      refreshToken: REFRESH,
      externalAccountId: "portal-42",
      scopes: "crm.objects.deals.read",
    });
  });

  it("asks for a reconnection when the key has rotated", async () => {
    const { client, rowFor } = fakeSupabase();
    await new CrmConnectionStore(client, KEY).save({
      workspaceId: FEED, provider: "hubspot", accessToken: TOKEN,
    });

    const other = parseKey(generateKey())!;
    const { connection, error } = await new CrmConnectionStore(client, other).load(FEED, "hubspot");

    // Not an exception: from the advertiser's side a rotated key, a corrupted
    // row and a revoked portal are the same event with the same fix.
    expect(connection).toBeNull();
    expect(error).toMatch(/[Rr]econnect/);
  });

  it("refuses to store anything at all with no key configured", async () => {
    const { client, rows, rowFor } = fakeSupabase();
    const store = new CrmConnectionStore(client, null);

    expect(store.configured).toBe(false);
    await expect(
      store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN })
    ).rejects.toThrow(/VBB_TOKEN_KEY/);
    // Nothing written in the clear as a fallback.
    expect(rows.size).toBe(0);
  });

  it("says a feed simply has no CRM connected, which is not an error", async () => {
    const { client, rowFor } = fakeSupabase();
    const { connection, error } = await new CrmConnectionStore(client, KEY).load("nope", "hubspot");
    expect(connection).toBeNull();
    expect(error).toBe("This feed has no CRM connected.");
  });

  it("records what happened on the last run", async () => {
    const { client, rows, rowFor } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN });

    await store.recordRun(FEED, "hubspot", { status: "ok", rows: 42 });
    expect(rowFor(FEED)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 42 });

    const { connection } = await store.load(FEED, "hubspot");
    expect(connection?.lastSyncStatus).toBe("ok");
    expect(connection?.lastSyncRows).toBe(42);
  });

  it("truncates an error to a sentence, never a stack trace", async () => {
    const { client, rows, rowFor } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN });

    await store.recordRun(FEED, "hubspot", { status: "failed", error: "x".repeat(2000) });
    expect(String(rowFor(FEED)!.last_sync_error)).toHaveLength(500);
  });

  it("forgets a connection completely on disconnect", async () => {
    const { client, rows, rowFor } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN });

    await store.disconnect(FEED, "hubspot");
    expect(rows.size).toBe(0);
    expect((await store.load(FEED, "hubspot")).connection).toBeNull();
  });
});
