import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { hashToken, tokenFromInput } from "@/lib/feed/token";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { keyFromEnv } from "@/lib/sync/secrets";
import { authorizeUrl, oauthConfigFromEnv, signState } from "@/lib/sync/hubspot/oauth";

/**
 * Starting a HubSpot connection.
 *
 * POST rather than GET, and the browser does the redirect with what comes
 * back. A GET would put the feed token in a URL, where it would reach the
 * server log, the browser history and the referrer header on the way out to
 * HubSpot — and that token is the whole credential for the feed.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const oauth = oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`);
  const key = keyFromEnv();
  const repo = feedRepositoryFromEnv();

  if (!repo || !oauth || !key) {
    return NextResponse.json(
      {
        ok: false,
        error: "Connecting a CRM is not set up on this deployment yet.",
      },
      { status: 503 }
    );
  }

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const token = tokenFromInput(typeof body.url === "string" ? body.url : "");
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Paste your feed URL so we know which feed to connect." },
      { status: 400 }
    );
  }

  const feed = await repo.findByTokenHash(await hashToken(token));
  if (!feed || feed.status !== "active") {
    return NextResponse.json({ ok: false, error: "No feed found for that URL." }, { status: 404 });
  }

  // The feed id travels through HubSpot, signed. The feed *token* does not
  // travel at all.
  return NextResponse.json({
    ok: true,
    authorizeUrl: authorizeUrl(oauth, signState(feed.id, key)),
  });
}
