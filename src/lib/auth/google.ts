import { signState, verifyState, type OAuthConfig } from "@/lib/sync/google/oauth";
import { postTokenForm } from "@/lib/sync/oauth/tokens";
import { generateInviteToken, type InviteStore } from "@/lib/workspace/invite";
import { generateWorkspaceKey } from "@/lib/workspace/key";
import { hashCreator } from "@/lib/workspace/selfServe";
import { looksLikeEmail, normalizeEmail } from "@/lib/leads/leads";
import { cleanName, safeNext } from "@/lib/workspace/signup";
import type { WorkspaceRepository } from "@/lib/workspace/repository";

/**
 * Signing in with Google.
 *
 * Google says who the person is, with a verified address, and that is the
 * whole account: no password to store, reset or leak. The address finds
 * the workspace it belongs to, or a new one is made with the person's name
 * on it, and the browser is handed the key the way an invite hands it over:
 * a one-time link, spent on arrival, minting a fresh key. Signing in again
 * from any device is the same button, which is what makes a workspace
 * outlive the browser it was started in.
 *
 * The same OAuth client as the Ads connection, with the identity scopes
 * only. Nothing here can touch an ad account.
 */

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export const SIGN_IN_SCOPES = ["openid", "email", "profile"];

/** A sign-in link is spent within minutes, not days. */
export const SIGN_IN_INVITE_TTL_MS = 10 * 60 * 1000;

export function signInUrl(config: OAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SIGN_IN_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Where to send them afterwards rides through Google inside the signed
 * state, so it cannot be altered on the way. Base64url has no dots, which
 * the signer uses as its separator.
 */
export function signInState(next: string, key: Buffer, now: Date = new Date()): string {
  const subject = Buffer.from(JSON.stringify({ next: safeNext(next), nonce: crypto.randomUUID() })).toString("base64url");
  return signState(subject, key, now);
}

export function readSignInState(state: string, key: Buffer, now: Date = new Date()): { next: string } | null {
  const subject = verifyState(state, key, now);
  if (!subject) return null;
  try {
    const parsed = JSON.parse(Buffer.from(subject, "base64url").toString()) as { next?: unknown };
    return { next: safeNext(typeof parsed.next === "string" ? parsed.next : null) };
  } catch {
    return null;
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** The code from the callback, exchanged for who the person is. */
export async function fetchGoogleIdentity(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GoogleIdentity | null> {
  const tokens = await postTokenForm(
    TOKEN,
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    },
    fetchImpl,
    new Date()
  );
  if (!tokens) return null;

  const res = await fetchImpl(USERINFO, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  if (!res.ok) return null;
  const info = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!info || typeof info.sub !== "string" || typeof info.email !== "string") return null;
  return {
    sub: info.sub,
    email: info.email,
    emailVerified: info.email_verified === true,
    name: typeof info.name === "string" ? info.name : null,
  };
}

export type SignInResult =
  | { ok: true; workspaceId: string; created: boolean; inviteToken: string }
  | { ok: false; error: string };

/**
 * Who they are, turned into a workspace and a one-time link into it.
 *
 * An address Google has not verified is not an identity: anyone can type
 * one into a Google account. Found by address, or made; either way the
 * link redeems into a fresh key, so nothing usable is ever stored.
 */
export async function signInWithGoogle(opts: {
  workspaces: WorkspaceRepository;
  invites: InviteStore;
  identity: GoogleIdentity;
  ip: string | null;
  now?: Date;
}): Promise<SignInResult> {
  const { identity } = opts;
  const now = opts.now ?? new Date();
  if (!identity.emailVerified || !looksLikeEmail(identity.email)) {
    return { ok: false, error: "Google did not confirm that address. Use a Google account with a verified email." };
  }
  const email = normalizeEmail(identity.email);

  let workspace = await opts.workspaces.findByContactEmail(email);
  let created = false;
  if (workspace && workspace.status !== "active") {
    return { ok: false, error: "This workspace is suspended. Get in touch and we will sort it out." };
  }
  if (!workspace) {
    const placeholder = await generateWorkspaceKey();
    workspace = await opts.workspaces.create({
      name: cleanName(identity.name) ?? email,
      keyHash: placeholder.keyHash,
      keyPrefix: placeholder.keyPrefix,
      createdIpHash: await hashCreator(opts.ip),
    });
    await opts.workspaces.setContactEmail(workspace.id, email);
    created = true;
  }

  const invite = await generateInviteToken();
  await opts.invites.create(workspace.id, invite.tokenHash, new Date(now.getTime() + SIGN_IN_INVITE_TTL_MS));
  return { ok: true, workspaceId: workspace.id, created, inviteToken: invite.token };
}
