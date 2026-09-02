import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { inviteStoreFromEnv, workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { hashInviteToken, looksLikeInviteToken } from "@/lib/workspace/invite";
import { generateWorkspaceKey } from "@/lib/workspace/key";

/**
 * Spending a one-time link.
 *
 * This is the only route in the product that hands out a workspace key, and it
 * does so by minting one rather than reading one back - nothing anywhere
 * stores a usable key, so there is nothing to read back.
 *
 * Deliberately unauthenticated: possession of an unspent, unexpired invite is
 * the credential. What keeps that safe is that the invite is single-use, dies
 * in three days, and is stored only as a hash.
 *
 * Every failure returns the same message. An attacker guessing tokens must not
 * learn from the response whether a token existed and was spent, existed and
 * expired, or never existed - that distinction is the whole value of guessing.
 * The operator can see which it was; the caller cannot.
 */

export const runtime = "nodejs";

const REFUSED = "This link has already been used, or it has expired. Ask for a new one.";

export async function POST(request: Request) {
  const workspaces = workspaceRepositoryFromEnv();
  const invites = inviteStoreFromEnv();

  if (!workspaces || !invites) {
    return NextResponse.json(
      { ok: false, error: "This deployment is not set up yet." },
      { status: 503 }
    );
  }

  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";

  // Shape-checked before hashing, so a truncated link - the commonest failure,
  // because mail clients wrap long URLs - never becomes a database query.
  if (!looksLikeInviteToken(token)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "That link looks incomplete. Copy the whole thing from the message, including everything after the equals sign.",
      },
      { status: 400 }
    );
  }

  // Finding it and spending it are one statement, so two clicks cannot both
  // mint a key.
  const invite = await invites.redeem(await hashInviteToken(token), new Date());
  if (!invite) {
    return NextResponse.json({ ok: false, error: REFUSED }, { status: 400 });
  }

  const workspace = await workspaces.findById(invite.workspaceId);
  if (!workspace) {
    return NextResponse.json({ ok: false, error: REFUSED }, { status: 400 });
  }
  if (workspace.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "This workspace is suspended. Get in touch and we'll sort it out." },
      { status: 403 }
    );
  }

  // Minted here, not retrieved. Redeeming retires whatever key came before,
  // which is the right outcome for the case this exists to serve: someone who
  // has just told us they no longer have theirs.
  const generated = await generateWorkspaceKey();
  await workspaces.rotateKey(workspace.id, generated.keyHash, generated.keyPrefix);

  /*
   * Whether they have been here before, so the landing page can point at the
   * right screen rather than at the same one for everybody.
   *
   * A new partner's overview is empty by definition, and sending them there
   * first says "nothing here" at the exact moment they are deciding whether
   * this is worth their afternoon. Someone who lost their key wants the
   * opposite - their overview, not a fresh analysis over the top of the model
   * they already have.
   *
   * Best-effort. A link that opens is worth more than a link that knows which
   * button to bold, so a failure here just falls back to treating them as new.
   */
  let returning = false;
  try {
    const feeds = feedRepositoryFromEnv();
    if (feeds) {
      const existing = await feeds.listForWorkspace(workspace.id);
      returning = existing.length > 0;
    }
  } catch (error) {
    console.error("checking whether a redeemed workspace has a feed failed:", error);
  }

  return NextResponse.json({
    ok: true,
    workspaceName: workspace.name,
    returning,
    // The one time this value exists outside the customer's browser.
    key: generated.key,
  });
}
