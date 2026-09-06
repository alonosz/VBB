import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { publishFeed, type PublishBody } from "@/lib/feed/handlers";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeOrCreateWorkspace } from "@/lib/workspace/selfServe";
import { callerIp } from "@/lib/workspace/callerIp";

/**
 * Publishing a feed.
 *
 * Authorised by the workspace key, not the feed token. The feed token reads a
 * CSV and does nothing else; anything that creates or changes state belongs to
 * the credential that never leaves the advertiser.
 *
 * The browser prices the leads and sends the finished rows; this stores them
 * and hands back a URL. It deliberately cannot price anything itself - no CRM
 * data reaches this side - which is what makes the feed an artifact the
 * advertiser approved rather than something recomputed behind them.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const repo = feedRepositoryFromEnv();
  const workspaces = workspaceRepositoryFromEnv();
  if (!repo || !workspaces) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Feeds are not set up on this deployment yet. Download the CSV instead, or add the Supabase keys.",
      },
      { status: 503 }
    );
  }

  let body: PublishBody;
  try {
    body = (await request.json()) as PublishBody;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  // Not the request's origin: on Vercel that can be a per-deployment URL, and
  // a feed link pinned to one build rots the next time anything ships.
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  // A first publish from a browser with no workspace mints one, the way the
  // connection routes do. Nobody is asked for a key they have never seen.
  const auth = await authorizeOrCreateWorkspace({
    repo: workspaces,
    presented: body.workspaceKey,
    ip: callerIp(request),
  });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const result = await publishFeed(repo, body, origin, auth.workspace.id);
  if (auth.mintedKey && result.status === 200) {
    // The one moment the key exists outside a hash: it rides back with the
    // publish result so the browser can keep it.
    try {
      const parsed = JSON.parse(result.body) as Record<string, unknown>;
      return NextResponse.json({ ...parsed, workspaceKey: auth.mintedKey }, { status: 200 });
    } catch {
      // A non-JSON body is unexpected here; fall through unchanged.
    }
  }
  return new NextResponse(result.body, { status: result.status, headers: result.headers });
}
