import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CrmConnectionStore } from "./connections";
import { generateKey, parseKey } from "./secrets";

const KEY = parseKey(generateKey())!;
// The store is keyed on a workspace now; the constant is that id.
const FEED = "feed-1";
const TOKEN = "crm-token-placeholder-not-a-real-credential";
const REFRESH = "refresh-9a8b7c6d";

/**
 * Just enough of the Supabase query builder for the calls this store makes,
 * keeping the rows visible so a test can assert what actually got written —
 * which is the whole point here, since the promise is about what is stored.
 */
function fakeSupabase() {
  const rows = new Map<string, Record<string, unknown>>();

  const builder = (table: string) => {
    let filterValue: string | null = null;
    let pending: "select" | "update" | "delete" | null = null;
    let updateRow: Record<string, unknown> | null = null;

    const api: Record<string, unknown> = {
      upsert(row: Record<string, unknown>) {
        rows.set(String(row.workspace_id), { ...(rows.get(String(row.workspace_id)) ?? {}), ...row });
        return Promise.resolve({ error: null });
      },
      select() {
        pending = "select";
        // Unfiltered select, used by connectedWorkspaceIds.
        const all = [...rows.values()];
        return Object.assign(Promise.resolve({ data: all, error: null }), api);
      },
      update(row: Record<string, unknown>) {
        pending = "update";
        updateRow = row;
        return api;
      },
      delete() {
        pending = "delete";
        return api;
      },
      eq(_column: string, value: string) {
        filterValue = value;
        if (pending === "update") {
          const existing = rows.get(value);
          if (existing) rows.set(value, { ...existing, ...updateRow });
          return Promise.resolve({ error: null });
        }
        if (pending === "delete") {
          rows.delete(value);
          return Promise.resolve({ error: null });
        }
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows.get(filterValue ?? "") ?? null, error: null });
      },
    };
    void table;
    return api;
  };

  return {
    client: { from: builder } as unknown as SupabaseClient,
    rows,
  };
}

describe("CrmConnectionStore", () => {
  it("stores a token only in encrypted form", async () => {
    const { client, rows } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);

    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN, refreshToken: REFRESH });

    const written = JSON.stringify(rows.get(FEED));
    // The promise, checked against what actually reached the row.
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain(REFRESH);
    expect(written).not.toContain("crm-token-placeholder");
    expect(rows.get(FEED)!.access_token).toMatch(/^v1\./);
    expect(rows.get(FEED)!.refresh_token).toMatch(/^v1\./);
  });

  it("gives the plaintext back on load", async () => {
    const { client } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({
      workspaceId: FEED, provider: "hubspot", accessToken: TOKEN, refreshToken: REFRESH,
      externalAccountId: "portal-42", scopes: "crm.objects.deals.read",
    });

    const { connection, error } = await store.load(FEED);
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
    const { client } = fakeSupabase();
    await new CrmConnectionStore(client, KEY).save({
      workspaceId: FEED, provider: "hubspot", accessToken: TOKEN,
    });

    const other = parseKey(generateKey())!;
    const { connection, error } = await new CrmConnectionStore(client, other).load(FEED);

    // Not an exception: from the advertiser's side a rotated key, a corrupted
    // row and a revoked portal are the same event with the same fix.
    expect(connection).toBeNull();
    expect(error).toMatch(/[Rr]econnect/);
  });

  it("refuses to store anything at all with no key configured", async () => {
    const { client, rows } = fakeSupabase();
    const store = new CrmConnectionStore(client, null);

    expect(store.configured).toBe(false);
    await expect(
      store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN })
    ).rejects.toThrow(/VBB_TOKEN_KEY/);
    // Nothing written in the clear as a fallback.
    expect(rows.size).toBe(0);
  });

  it("says a feed simply has no CRM connected, which is not an error", async () => {
    const { client } = fakeSupabase();
    const { connection, error } = await new CrmConnectionStore(client, KEY).load("nope");
    expect(connection).toBeNull();
    expect(error).toBe("This feed has no CRM connected.");
  });

  it("records what happened on the last run", async () => {
    const { client, rows } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN });

    await store.recordRun(FEED, { status: "ok", rows: 42 });
    expect(rows.get(FEED)).toMatchObject({ last_sync_status: "ok", last_sync_rows: 42 });

    const { connection } = await store.load(FEED);
    expect(connection?.lastSyncStatus).toBe("ok");
    expect(connection?.lastSyncRows).toBe(42);
  });

  it("truncates an error to a sentence, never a stack trace", async () => {
    const { client, rows } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN });

    await store.recordRun(FEED, { status: "failed", error: "x".repeat(2000) });
    expect(String(rows.get(FEED)!.last_sync_error)).toHaveLength(500);
  });

  it("forgets a connection completely on disconnect", async () => {
    const { client, rows } = fakeSupabase();
    const store = new CrmConnectionStore(client, KEY);
    await store.save({ workspaceId: FEED, provider: "hubspot", accessToken: TOKEN });

    await store.disconnect(FEED);
    expect(rows.size).toBe(0);
    expect((await store.load(FEED)).connection).toBeNull();
  });
});
