import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  InMemoryInviteStore,
  INVITE_PREFIX,
  looksLikeInviteToken,
} from "./invite";
import { generateWorkspaceKey } from "./key";
import { InMemoryWorkspaceRepository } from "./repository";

const HOUR = 3_600_000;

/**
 * The redemption path the /join route drives, exercised against the same
 * in-memory stores. What is worth protecting here is not that a good link
 * works - it is every way a bad one must not.
 */
async function setup() {
  const workspaces = new InMemoryWorkspaceRepository();
  const invites = new InMemoryInviteStore();

  const placeholder = await generateWorkspaceKey();
  const workspace = await workspaces.create({
    name: "Northwind Plumbing",
    keyHash: placeholder.keyHash,
    keyPrefix: placeholder.keyPrefix,
  });

  const invite = await generateInviteToken();
  await invites.create(workspace.id, invite.tokenHash, new Date(Date.now() + 72 * HOUR));

  return { workspaces, invites, workspace, token: invite.token, placeholder };
}

/** What the route does after a successful redeem. */
async function mintFor(
  workspaces: InMemoryWorkspaceRepository,
  workspaceId: string
): Promise<string> {
  const generated = await generateWorkspaceKey();
  await workspaces.rotateKey(workspaceId, generated.keyHash, generated.keyPrefix);
  return generated.key;
}

describe("invite tokens", () => {
  it("are shaped so a truncated link is caught before it becomes a query", async () => {
    const { token } = await generateInviteToken();
    expect(looksLikeInviteToken(token)).toBe(true);

    // Mail clients wrap long URLs; this is the commonest real failure.
    expect(looksLikeInviteToken(token.slice(0, 12))).toBe(false);
    expect(looksLikeInviteToken("")).toBe(false);
    expect(looksLikeInviteToken("vbb_ws_notaninvite")).toBe(false);
  });

  it("never carry the token itself into storage", async () => {
    const { token, tokenHash } = await generateInviteToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).not.toContain(INVITE_PREFIX);
  });

  it("are distinct across calls", async () => {
    const a = await generateInviteToken();
    const b = await generateInviteToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe("redeeming", () => {
  it("mints a working key and retires the one before it", async () => {
    const { workspaces, invites, workspace, token, placeholder } = await setup();

    const redeemed = await invites.redeem(await hashInviteToken(token), new Date());
    expect(redeemed?.workspaceId).toBe(workspace.id);

    const key = await mintFor(workspaces, workspace.id);

    // The new key opens the same workspace - the feed and model attached to it
    // are the whole reason this is a rotation rather than a new customer.
    const opened = await workspaces.findByKey(key);
    expect(opened?.id).toBe(workspace.id);
    expect(opened?.name).toBe("Northwind Plumbing");

    // And the key that existed before it no longer opens anything.
    expect(await workspaces.findByKey(placeholder.key)).toBeNull();
  });

  it("refuses a second use of the same link", async () => {
    const { invites, token } = await setup();
    const hash = await hashInviteToken(token);

    expect(await invites.redeem(hash, new Date())).not.toBeNull();
    expect(await invites.redeem(hash, new Date())).toBeNull();
  });

  it("refuses a link past its expiry", async () => {
    const { workspaces, invites } = await setup();
    const workspace = (await workspaces.list())[0];

    const invite = await generateInviteToken();
    await invites.create(workspace.id, invite.tokenHash, new Date(Date.now() + HOUR));

    const later = new Date(Date.now() + 2 * HOUR);
    expect(await invites.redeem(await hashInviteToken(invite.token), later)).toBeNull();
  });

  it("refuses a token that was never issued", async () => {
    const { invites } = await setup();
    const stranger = await generateInviteToken();
    expect(await invites.redeem(await hashInviteToken(stranger.token), new Date())).toBeNull();
  });

  it("keeps two customers' links apart", async () => {
    const { workspaces, invites, workspace: first } = await setup();

    const otherKey = await generateWorkspaceKey();
    const second = await workspaces.create({
      name: "Southgate Roofing",
      keyHash: otherKey.keyHash,
      keyPrefix: otherKey.keyPrefix,
    });
    const secondInvite = await generateInviteToken();
    await invites.create(second.id, secondInvite.tokenHash, new Date(Date.now() + 72 * HOUR));

    const redeemed = await invites.redeem(await hashInviteToken(secondInvite.token), new Date());
    expect(redeemed?.workspaceId).toBe(second.id);

    // Spending one customer's link leaves the other's key untouched.
    const key = await mintFor(workspaces, second.id);
    expect((await workspaces.findByKey(key))?.id).toBe(second.id);
    expect((await workspaces.findById(first.id))?.name).toBe("Northwind Plumbing");
  });

  it("issues a usable link to a customer who lost their key", async () => {
    const { workspaces, invites, workspace, token } = await setup();

    // They redeemed once, then cleared their browser.
    await invites.redeem(await hashInviteToken(token), new Date());
    const lost = await mintFor(workspaces, workspace.id);

    // The operator sends another.
    const again = await generateInviteToken();
    await invites.create(workspace.id, again.tokenHash, new Date(Date.now() + 72 * HOUR));
    expect(await invites.redeem(await hashInviteToken(again.token), new Date())).not.toBeNull();

    const fresh = await mintFor(workspaces, workspace.id);
    expect((await workspaces.findByKey(fresh))?.id).toBe(workspace.id);
    expect(await workspaces.findByKey(lost)).toBeNull();
  });
});
