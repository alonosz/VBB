import { looksLikeEmail, normalizeEmail } from "@/lib/leads/leads";
import { authorizeOrCreateWorkspace } from "./selfServe";
import type { Workspace, WorkspaceRepository } from "./repository";

/**
 * Signing up, which here means putting a name and an address on a workspace.
 *
 * There is no password and nothing to verify yet. The workspace this browser
 * holds, or a new one if it holds none, gets the person's name and email,
 * and from then on the operator can tell it apart and the advertiser can be
 * let back in from another machine. It happens once, on its own page, at the
 * first moment something needs an owner: a CRM or ad account about to be
 * connected. Never for somebody who only uploads a file.
 */

export const MAX_NAME_CHARS = 80;

export type SignupResult =
  | { ok: true; workspace: Workspace; mintedKey: string | null; name: string; email: string }
  | { ok: false; status: number; error: string };

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 2) return null;
  // A name is words. Anything that reads like an address, a link or markup
  // is somebody testing the box, and it does not get to name a workspace.
  if (/[<>@/\\]/.test(t)) return null;
  return t.slice(0, MAX_NAME_CHARS);
}

export async function completeSignup(opts: {
  repo: WorkspaceRepository;
  presented: unknown;
  ip: string | null;
  name: unknown;
  email: unknown;
}): Promise<SignupResult> {
  const name = cleanName(opts.name);
  if (!name) return { ok: false, status: 400, error: "Tell us your name." };
  if (typeof opts.email !== "string" || !looksLikeEmail(opts.email)) {
    return { ok: false, status: 400, error: "That does not look like an email address." };
  }
  const email = normalizeEmail(opts.email);

  const auth = await authorizeOrCreateWorkspace({ repo: opts.repo, presented: opts.presented, ip: opts.ip });
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };

  await opts.repo.setContactEmail(auth.workspace.id, email);
  await opts.repo.setName(auth.workspace.id, name);

  return {
    ok: true,
    workspace: { ...auth.workspace, name, contactEmail: email },
    mintedKey: auth.mintedKey,
    name,
    email,
  };
}

/** Where to send them afterwards: a path on this site, never somewhere else. */
export function safeNext(raw: string | null | undefined, fallback = "/diagnostic"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}
