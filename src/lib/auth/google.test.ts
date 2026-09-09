import { describe, expect, it } from "vitest";
import { InMemoryWorkspaceRepository } from "@/lib/workspace/repository";
import { InMemoryInviteStore, hashInviteToken } from "@/lib/workspace/invite";
import { SIGN_IN_SCOPES, fetchGoogleIdentity, readSignInState, signInState, signInUrl, signInWithGoogle } from "./google";

const KEY = Buffer.from("k".repeat(32));
const NOW = new Date("2026-09-09T10:00:00Z");
const config = { clientId: "cid", clientSecret: "sec", redirectUri: "https://x/api/auth/google/callback" };

describe("the sign-in link", () => {
  it("asks Google for identity only, never for ads access", () => {
    const url = new URL(signInUrl(config, "s"));
    expect(url.searchParams.get("scope")).toBe(SIGN_IN_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toMatch(/adwords|datamanager/);
    expect(url.searchParams.get("access_type")).toBeNull();
  });

  it("carries the return path through Google, signed, and only on this site", () => {
    const state = signInState("/diagnostic/upload", KEY, NOW);
    expect(readSignInState(state, KEY, NOW)).toEqual({ next: "/diagnostic/upload" });
    expect(readSignInState(signInState("https://evil.com", KEY, NOW), KEY, NOW)).toEqual({ next: "/diagnostic" });
    expect(readSignInState(state + "x", KEY, NOW)).toBeNull();
    expect(readSignInState(state, Buffer.from("other".padEnd(32, "o")), NOW)).toBeNull();
  });
});

describe("who Google says they are", () => {
  it("exchanges the code and reads the profile", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (String(url).includes("/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      }
      return new Response(JSON.stringify({ sub: "123", email: "Dana@Example.com", email_verified: true, name: "Dana Klein" }));
    }) as unknown as typeof fetch;
    const id = await fetchGoogleIdentity(config, "code", fetchImpl);
    expect(id).toEqual({ sub: "123", email: "Dana@Example.com", emailVerified: true, name: "Dana Klein" });
    expect(calls[0]).toContain("oauth2.googleapis.com/token");
    expect(calls[1]).toContain("userinfo");
  });

  it("is nothing when Google refuses", async () => {
    const fetchImpl = (async () => new Response("no", { status: 400 })) as unknown as typeof fetch;
    expect(await fetchGoogleIdentity(config, "code", fetchImpl)).toBeNull();
  });
});

describe("signing in", () => {
  const identity = { sub: "123", email: "Dana@Example.com", emailVerified: true, name: "Dana Klein" };

  it("makes a workspace for a new address and hands back a one-time link into it", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const invites = new InMemoryInviteStore();
    const r = await signInWithGoogle({ workspaces, invites, identity, ip: "1.1.1.1", now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    const ws = await workspaces.findById(r.workspaceId);
    expect(ws?.name).toBe("Dana Klein");
    expect(ws?.contactEmail).toBe("dana@example.com");
    const spent = await invites.redeem(await hashInviteToken(r.inviteToken), NOW);
    expect(spent?.workspaceId).toBe(r.workspaceId);
  });

  it("finds the workspace an address already has rather than making a second", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const invites = new InMemoryInviteStore();
    const first = await signInWithGoogle({ workspaces, invites, identity, ip: null, now: NOW });
    const again = await signInWithGoogle({ workspaces, invites, identity, ip: null, now: NOW });
    expect(first.ok && again.ok && again.workspaceId === first.workspaceId).toBe(true);
    expect(again.ok && again.created).toBe(false);
    expect((await workspaces.list()).length).toBe(1);
  });

  it("refuses an address Google has not verified", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const r = await signInWithGoogle({ workspaces, invites: new InMemoryInviteStore(), identity: { ...identity, emailVerified: false }, ip: null });
    expect(r.ok).toBe(false);
    expect((await workspaces.list()).length).toBe(0);
  });

  it("gives the link ten minutes, not three days", async () => {
    const workspaces = new InMemoryWorkspaceRepository();
    const invites = new InMemoryInviteStore();
    const r = await signInWithGoogle({ workspaces, invites, identity, ip: null, now: NOW });
    if (!r.ok) throw new Error("setup");
    const later = new Date(NOW.getTime() + 11 * 60_000);
    expect(await invites.redeem(await hashInviteToken(r.inviteToken), later)).toBeNull();
  });
});
