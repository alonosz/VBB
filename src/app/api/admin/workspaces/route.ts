import { NextResponse } from "next/server";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { generateWorkspaceKey } from "@/lib/workspace/key";
import { adminKeyFromEnv, adminKeyMatches } from "@/lib/workspace/admin";

/**
 * Creating and listing customers.
 *
 * The one screen an operator needs that no workspace key can authorise —
 * creating a workspace is what brings a key into existence. Guarded by the
 * operator's own password, compared in constant time.
 *
 * A workspace key is returned exactly once, on creation, and never again: only
 * its hash is stored. That is deliberate and the response says so, because an
 * operator who assumes they can look it up later will lose it.
 */

export const runtime = "nodejs";

interface Body {
  adminKey?: unknown;
  action?: unknown;
  name?: unknown;
  workspaceId?: unknown;
}

export async function POST(request: Request) {
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

  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ ok: false, error: "Give the customer a name." }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ ok: false, error: "That name is too long." }, { status: 400 });
    }

    const generated = await generateWorkspaceKey();
    const workspace = await workspaces.create({
      name,
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
    });

    return NextResponse.json({
      ok: true,
      workspace: { id: workspace.id, name: workspace.name, keyPrefix: workspace.keyPrefix },
      // Shown once. Only a hash is stored, so this cannot be recovered.
      key: generated.key,
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
