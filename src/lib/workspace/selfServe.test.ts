import { describe, expect, it } from "vitest";
import {
  authorizeOrCreateWorkspace,
  CREATION_WINDOW_MS,
  hashCreator,
  MAX_WORKSPACES_PER_CALLER_PER_HOUR,
  selfServeName,
} from "./selfServe";
import { InMemoryWorkspaceRepository } from "./repository";
import { generateWorkspaceKey, looksLikeWorkspaceKey } from "./key";

const IP = "203.0.113.7";

async function withCustomer() {
  const repo = new InMemoryWorkspaceRepository();
  const generated = await generateWorkspaceKey();
  const workspace = await repo.create({
    name: "Northwind Plumbing",
    keyHash: generated.keyHash,
    keyPrefix: generated.keyPrefix,
  });
  return { repo, workspace, key: generated.key };
}

describe("a visitor with no key", () => {
  it("gets a workspace without being asked for anything", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const access = await authorizeOrCreateWorkspace({ repo, presented: undefined, ip: IP });

    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.mintedKey).not.toBeNull();
    expect(looksLikeWorkspaceKey(access.mintedKey!)).toBe(true);
  });

  it("hands back a key that actually opens the workspace it made", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const access = await authorizeOrCreateWorkspace({ repo, presented: "", ip: IP });
    if (!access.ok || !access.mintedKey) throw new Error("expected a minted key");

    // The one moment the key exists outside a hash. If it did not open the
    // workspace, the customer would own something unreachable.
    const opened = await repo.findByKey(access.mintedKey);
    expect(opened?.id).toBe(access.workspace.id);
  });

  it("treats whitespace as no key rather than as a bad one", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const access = await authorizeOrCreateWorkspace({ repo, presented: "   ", ip: IP });
    expect(access.ok).toBe(true);
  });

  it("gives each visitor their own", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const a = await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP });
    const b = await authorizeOrCreateWorkspace({ repo, presented: null, ip: "198.51.100.4" });

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.workspace.id).not.toBe(b.workspace.id);
    expect(a.mintedKey).not.toBe(b.mintedKey);
  });
});

describe("a key that does not work", () => {
  /*
   * The whole reason this file is careful. Minting on a bad key would hand a
   * customer with a typo a fresh empty workspace, orphaning the feed Google is
   * reading and the model that prices it, with nothing on screen to say so.
   */
  it("is refused rather than quietly replaced with a new workspace", async () => {
    const { repo } = await withCustomer();
    const before = (await repo.list()).length;

    const access = await authorizeOrCreateWorkspace({
      repo,
      presented: "vbb_ws_thisisnotarealkeyatall00",
      ip: IP,
    });

    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.status).toBe(401);
    expect((await repo.list()).length).toBe(before);
  });

  it("refuses a feed token with the message that names the difference", async () => {
    const { repo } = await withCustomer();
    const access = await authorizeOrCreateWorkspace({
      repo,
      presented: "vbb_live_8f2a1b3c4d5e6f708192a3b4c5d6e7f8",
      ip: IP,
    });
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.error).toMatch(/feed URL/i);
  });

  it("refuses a suspended workspace rather than minting around it", async () => {
    const { repo, workspace, key } = await withCustomer();
    await repo.suspend(workspace.id);
    const before = (await repo.list()).length;

    const access = await authorizeOrCreateWorkspace({ repo, presented: key, ip: IP });
    expect(access.ok).toBe(false);
    expect((await repo.list()).length).toBe(before);
  });
});

describe("a key that works", () => {
  it("opens the existing workspace and mints nothing", async () => {
    const { repo, workspace, key } = await withCustomer();
    const access = await authorizeOrCreateWorkspace({ repo, presented: key, ip: IP });

    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.workspace.id).toBe(workspace.id);
    expect(access.mintedKey).toBeNull();
    expect((await repo.list()).length).toBe(1);
  });
});

describe("the rate limit", () => {
  it("stops one caller after the cap", async () => {
    const repo = new InMemoryWorkspaceRepository();

    for (let i = 0; i < MAX_WORKSPACES_PER_CALLER_PER_HOUR; i++) {
      const ok = await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP });
      expect(ok.ok, `mint ${i + 1}`).toBe(true);
    }

    const refused = await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.status).toBe(429);
  });

  it("does not count one caller against another", async () => {
    const repo = new InMemoryWorkspaceRepository();
    for (let i = 0; i < MAX_WORKSPACES_PER_CALLER_PER_HOUR; i++) {
      await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP });
    }
    const other = await authorizeOrCreateWorkspace({ repo, presented: null, ip: "198.51.100.4" });
    expect(other.ok).toBe(true);
  });

  it("forgets what happened before the window", async () => {
    let now = new Date("2026-08-30T10:00:00Z");
    const repo = new InMemoryWorkspaceRepository(() => now);

    for (let i = 0; i < MAX_WORKSPACES_PER_CALLER_PER_HOUR; i++) {
      await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP, now });
    }
    expect((await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP, now })).ok).toBe(false);

    now = new Date(now.getTime() + CREATION_WINDOW_MS + 1000);
    expect((await authorizeOrCreateWorkspace({ repo, presented: null, ip: IP, now })).ok).toBe(true);
  });

  it("does not lock out everyone behind a proxy that strips the address", async () => {
    const repo = new InMemoryWorkspaceRepository();
    for (let i = 0; i < MAX_WORKSPACES_PER_CALLER_PER_HOUR + 3; i++) {
      const access = await authorizeOrCreateWorkspace({ repo, presented: null, ip: null });
      expect(access.ok, `mint ${i + 1}`).toBe(true);
    }
  });

  it("never counts a caller by their raw address", async () => {
    const hash = await hashCreator(IP);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(IP);
    expect(await hashCreator(null)).toBeNull();
    expect(await hashCreator("  ")).toBeNull();
  });
});

describe("what the operator sees in the list", () => {
  it("says it was self-serve, and when, rather than inventing a company", () => {
    const name = selfServeName(new Date("2026-08-30T14:22:31Z"));
    expect(name).toBe("Self-serve, 2026-08-30 14:22 UTC");
    // The column is bounded at 120 characters, and a label nobody typed
    // should stay comfortably inside it.
    expect(name.length).toBeLessThan(60);
  });

  it("distinguishes two minted a minute apart", () => {
    expect(selfServeName(new Date("2026-08-30T14:22:00Z"))).not.toBe(
      selfServeName(new Date("2026-08-30T14:23:00Z"))
    );
  });
});
