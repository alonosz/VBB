import type { Workspace, WorkspaceRepository } from "./repository";
import { generateWorkspaceKey, looksLikeWorkspaceKey } from "./key";
import { authorizeWorkspace } from "./authorize";
import { sha256Hex } from "@/lib/export/googleAds";

/**
 * A workspace that comes into existence because somebody clicked a button.
 *
 * The workspace key was fine while every customer was created by hand and
 * reached by invite link. It stopped being fine the moment "Connect HubSpot"
 * appeared on step 2: the landing page promises no account needed, and a
 * marketer three minutes into an evaluation cannot be asked to produce a
 * `vbb_ws_` credential they have never heard of.
 *
 * So one is minted for them, silently. No form, no password, no email, nothing
 * on screen. The key goes into the browser that asked for it and surfaces only
 * later, if they want their model on a second device, by which point they have
 * something worth keeping.
 *
 * ## The distinction that matters
 *
 * **No key presented** means a new visitor, and gets a new workspace.
 *
 * **A key presented that does not work** is refused, and must be. Minting on a
 * bad key would mean a customer with a typo, an expired browser, or a
 * half-copied string silently gets a fresh empty workspace instead of an
 * error - orphaning the feed Google is reading and the model that prices it,
 * with nothing on screen to say what happened. A wrong key is always an error.
 */

/**
 * How many workspaces one caller may mint in an hour.
 *
 * Not a security boundary: anyone determined has more addresses. It stops the
 * accident and the idle script, which between them are every case that has
 * ever actually filled a table like this with rubbish. Set above what a real
 * person hits - browsers get cleared, sessions get lost - and far below what
 * a loop achieves in a second.
 */
export const MAX_WORKSPACES_PER_CALLER_PER_HOUR = 5;
export const CREATION_WINDOW_MS = 60 * 60 * 1000;

/** Salted, so the table is not a rainbow table of everyone who visited. */
export async function hashCreator(ip: string | null): Promise<string | null> {
  if (!ip?.trim()) return null;
  return sha256Hex(`workspace:${ip.trim()}`);
}

/**
 * What an operator sees in the customer list for one of these.
 *
 * Honest rather than pretty. Nobody typed a company name, so inventing one
 * would be a fiction in the one list an operator uses to tell customers apart.
 * The date is what makes two of them distinguishable at a glance.
 */
export function selfServeName(now: Date): string {
  const when = now.toISOString().slice(0, 16).replace("T", " ");
  return `Self-serve, ${when} UTC`;
}

export type WorkspaceAccess =
  | { ok: true; workspace: Workspace; mintedKey: string | null }
  | { ok: false; status: number; error: string };

export interface SelfServeOptions {
  repo: WorkspaceRepository;
  presented: unknown;
  /** Caller address, already extracted from the request headers. */
  ip: string | null;
  now?: Date;
}

/**
 * Resolve the workspace for a request, creating one if there is no key at all.
 *
 * `mintedKey` is non-null exactly when a workspace was created, and is the one
 * moment the key exists outside a hash. The caller must return it so the
 * browser can store it; nothing else will ever be able to.
 */
export async function authorizeOrCreateWorkspace(
  opts: SelfServeOptions
): Promise<WorkspaceAccess> {
  const { repo, presented } = opts;
  const now = opts.now ?? new Date();
  const offered = typeof presented === "string" ? presented.trim() : "";

  // Anything that looks like a credential is checked as one, including a
  // wrong one. Only the complete absence of a key means "new visitor".
  if (offered !== "") {
    const auth = await authorizeWorkspace(repo, offered);
    return auth.ok
      ? { ok: true, workspace: auth.workspace, mintedKey: null }
      : { ok: false, status: auth.status, error: auth.error };
  }

  const ipHash = await hashCreator(opts.ip);
  const since = new Date(now.getTime() - CREATION_WINDOW_MS);

  if ((await repo.countCreatedSince(ipHash, since)) >= MAX_WORKSPACES_PER_CALLER_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      error: "Too many new workspaces from here in the last hour. Try again shortly.",
    };
  }

  const generated = await generateWorkspaceKey();
  const workspace = await repo.create({
    name: selfServeName(now),
    keyHash: generated.keyHash,
    keyPrefix: generated.keyPrefix,
    createdIpHash: ipHash,
  });

  // Belt and braces: a generator that produced something the authorizer would
  // reject would hand the browser a key that fails on the next request, and
  // the customer would have a workspace they can never reach again.
  if (!looksLikeWorkspaceKey(generated.key)) {
    return { ok: false, status: 500, error: "Could not set up a workspace. Try again." };
  }

  return { ok: true, workspace, mintedKey: generated.key };
}
