import { NextResponse } from "next/server";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";
import { buildOverview } from "@/lib/workspace/overview";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { SupabaseSyncRunStore } from "@/lib/sync/runs";
import { keyFromEnv } from "@/lib/sync/secrets";

/**
 * Everything one customer's page shows.
 *
 * POST, because the workspace key is the credential and a key in a query
 * string reaches the server log, the browser history and every referrer header
 * on the way.
 *
 * Reading status changes nothing and is not counted as a feed fetch: looking
 * at the page must not spend the collection budget Google needs.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const feeds = feedRepositoryFromEnv();
  const workspaces = workspaceRepositoryFromEnv();
  const client = supabaseFromEnv();

  if (!feeds || !workspaces || !client) {
    return NextResponse.json(
      { ok: false, error: "This deployment is not set up yet." },
      { status: 503 }
    );
  }

  let body: { workspaceKey?: unknown };
  try {
    body = (await request.json()) as { workspaceKey?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const auth = await authorizeWorkspace(workspaces, body.workspaceKey);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const overview = await buildOverview(auth.workspace, {
    feeds,
    // Without an encryption key the connection simply reads as unreadable,
    // which is the truth and produces the right action on screen.
    connections: new CrmConnectionStore(client, keyFromEnv()),
    runs: new SupabaseSyncRunStore(client),
  });

  return NextResponse.json({ ok: true, overview });
}
