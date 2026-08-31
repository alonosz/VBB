import { NextResponse } from "next/server";
import { inviteStoreFromEnv, workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { generateWorkspaceKey } from "@/lib/workspace/key";
import { generateInviteToken, INVITE_TTL_HOURS } from "@/lib/workspace/invite";
import { adminKeyFromEnv, adminKeyMatches } from "@/lib/workspace/admin";
import { feedOrigin } from "@/lib/feed/origin";
import { describeDatabaseFailure } from "@/lib/db/failure";

/**
 * Creating and listing customers.
 *
 * The one screen an operator needs that no workspace key can authorise -
 * creating a workspace is what brings a key into existence. Guarded by the
 * operator's own password, compared in constant time.
 *
 * The operator never sees a workspace key. Creating a customer produces an
 * invite link instead; the key is minted in the customer's own browser when
 * they click it. That keeps a live credential out of the operator's email, and
 * makes "they lost their key" a solvable problem - sending a new link rotates
 * the key, where before the only recovery was a new workspace, which orphans
 * the feed and model attached to the old one.
 */

export const runtime = "nodejs";

interface Body {
  adminKey?: unknown;
  action?: unknown;
  name?: unknown;
  workspaceId?: unknown;
}

/**
 * Where the link points.
 *
 * The same origin resolution the feed URL uses, and for the same reason: a
 * link built from whatever host the operator happened to be looking at can
 * land on a per-deployment URL that is behind deployment protection or gone by
 * next week.
 */
function joinUrl(request: Request, token: string): string {
  const origin = feedOrigin({
    requestOrigin: new URL(request.url).origin,
    publicOrigin: process.env.VBB_PUBLIC_ORIGIN,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
  return `${origin}/join?t=${encodeURIComponent(token)}`;
}

/**
 * The wrapper exists so a database failure reaches the operator as words.
 *
 * Without it an exception escapes into the framework's error page, which is
 * not JSON, so the browser cannot read it and reports the one thing that is
 * definitely not true: that it could not reach the server. That message sent
 * somebody to check their internet connection over a migration nobody had run.
 */
export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    console.error("admin route failed:", error);
    return NextResponse.json(
      { ok: false, error: describeDatabaseFailure(error) },
      { status: 500 }
    );
  }
}

async function handle(request: Request) {
  const expected = adminKeyFromEnv();
  const workspaces = workspaceRepositoryFromEnv();

  if (!workspaces) {
    return NextResponse.json({ ok: false, error: "This deployment is not set up yet." }, { status: 503 });
  }
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Admin access is not configured. Set VBB_ADMIN_KEY in Vercel to a password of at least 16 characters, then redeploy.",
      },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  if (!adminKeyMatches(body.adminKey, expected)) {
    return NextResponse.json({ ok: false, error: "That admin password was not recognised." }, { status: 401 });
  }

  const action = body.action;

  if (action === "list") {
    const all = await workspaces.list();
    return NextResponse.json({
      ok: true,
      workspaces: all.map((w) => ({
        id: w.id,
        name: w.name,
        keyPrefix: w.keyPrefix,
        status: w.status,
        createdAt: w.createdAt.toISOString(),
      })),
    });
  }

  const invites = inviteStoreFromEnv();
  if (!invites) {
    return NextResponse.json({ ok: false, error: "This deployment is not set up yet." }, { status: 503 });
  }

  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ ok: false, error: "Give the customer a name." }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ ok: false, error: "That name is too long." }, { status: 400 });
    }

    // A workspace needs a key hash to exist, so one is minted and immediately
    // thrown away. Nobody is ever told it: redeeming the invite replaces it.
    // The row is never usable in the window before the link is clicked, which
    // is the point - an unclicked invite grants nothing.
    const placeholder = await generateWorkspaceKey();
    const workspace = await workspaces.create({
      name,
      keyHash: placeholder.keyHash,
      keyPrefix: placeholder.keyPrefix,
    });

    const invite = await generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
    await invites.create(workspace.id, invite.tokenHash, expiresAt);

    return NextResponse.json({
      ok: true,
      workspace: { id: workspace.id, name: workspace.name, keyPrefix: workspace.keyPrefix },
      // Shown once. Only a hash is stored, so this cannot be recovered.
      inviteUrl: joinUrl(request, invite.token),
      expiresAt: expiresAt.toISOString(),
    });
  }

  if (action === "invite") {
    const id = typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "Which workspace?" }, { status: 400 });
    }

    const workspace = await workspaces.findById(id);
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "No such customer." }, { status: 404 });
    }
    if (workspace.status !== "active") {
      return NextResponse.json(
        { ok: false, error: "That customer is suspended. Un-suspend them before sending a link." },
        { status: 409 }
      );
    }

    const invite = await generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);
    await invites.create(workspace.id, invite.tokenHash, expiresAt);

    return NextResponse.json({
      ok: true,
      workspace: { id: workspace.id, name: workspace.name, keyPrefix: workspace.keyPrefix },
      inviteUrl: joinUrl(request, invite.token),
      expiresAt: expiresAt.toISOString(),
    });
  }

  if (action === "suspend") {
    const id = typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "Which workspace?" }, { status: 400 });
    }
    await workspaces.suspend(id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
