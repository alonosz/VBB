import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { keyFromEnv } from "@/lib/sync/secrets";
import { oauthConfigFromEnv } from "@/lib/sync/hubspot/oauth";
import { syncAllFeeds } from "@/lib/sync/hubspot/syncFeed";
import { SupabaseSyncRunStore } from "@/lib/sync/runs";

/**
 * The nightly run.
 *
 * Everything of consequence happens in syncAllFeeds; this exists to check the
 * caller is the scheduler and to report what happened in a form a person can
 * read the next morning.
 *
 * The response deliberately carries counts and refusals but never a lead, a
 * value or a token. A cron log is not a place for someone's CRM.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // With no secret configured the endpoint stays shut rather than open. An
  // unprotected sync endpoint is a way to make someone else's portal do work.
  if (!secret?.trim()) return false;
  return request.headers.get("authorization") === `Bearer ${secret.trim()}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const repo = feedRepositoryFromEnv();
  const client = supabaseFromEnv();
  const key = keyFromEnv();
  const oauth = oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`);

  // No OAuth app is fine: a portal connected with a private app token has
  // nothing to refresh, so a run needs no client credentials.
  if (!repo || !client || !key) {
    return NextResponse.json(
      { ok: false, error: "CRM sync is not configured on this deployment." },
      { status: 503 }
    );
  }

  const started = Date.now();
  const outcomes = await syncAllFeeds({
    repo,
    connections: new CrmConnectionStore(client, key),
    runs: new SupabaseSyncRunStore(client),
    oauth,
  });

  const rowsAdded = outcomes.reduce((sum, o) => sum + (o.report?.rowsAdded ?? 0), 0);
  const failures = outcomes.filter((o) => o.error);

  return NextResponse.json({
    ok: true,
    feeds: outcomes.length,
    rowsAdded,
    tookMs: Date.now() - started,
    // Named so a run that quietly stopped working is visible in the log
    // rather than only in the database.
    problems: failures.map((o) => ({ feedId: o.feedId, error: o.error })),
  });
}
