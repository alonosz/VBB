import { looksLikeEmail, normalizeEmail } from "@/lib/leads/leads";
import type { WorkspaceRepository } from "./repository";

/**
 * The address given at the moment of connecting, put on the workspace.
 *
 * A connection hands us a credential for somebody's CRM or ad account, and
 * until now nothing said whose. The address is what turns a silently minted
 * workspace into one the operator can name and the advertiser can be let
 * back into from another machine. Never a password, and never asked of
 * somebody who only uploads a file: the file never leaves their browser, so
 * there is nothing to attach a name to.
 *
 * Silent on a bad address: the connection is the thing they asked for, and
 * the gate on screen already refused anything that did not look like one.
 */
export async function attachContactEmail(
  repo: WorkspaceRepository,
  workspaceId: string,
  raw: unknown
): Promise<boolean> {
  if (typeof raw !== "string" || !looksLikeEmail(raw)) return false;
  await repo.setContactEmail(workspaceId, normalizeEmail(raw));
  return true;
}
