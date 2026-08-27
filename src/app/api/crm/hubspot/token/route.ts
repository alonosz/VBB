import { NextResponse } from "next/server";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { hashToken, tokenFromInput } from "@/lib/feed/token";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { keyFromEnv } from "@/lib/sync/secrets";
import { HubSpotClient, verifyAccess } from "@/lib/sync/hubspot/client";

/**
 * Connecting one portal with a private app token.
 *
 * OAuth exists for connecting other people's portals. For an advertiser
 * connecting their own, it is a developer account, an app, a redirect URL and
 * a review cycle to achieve what a pasted token does immediately — so this
 * path exists, and the sync treats the result identically. A private token has
 * no refresh and no expiry, so the run simply never renews it.
 *
 * The token is checked against HubSpot before it is stored. A private app with
 * a scope left unticked would otherwise fail at six in the morning with nobody
 * watching; this turns that into an error the advertiser sees while the scopes
 * screen is still open.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const repo = feedRepositoryFromEnv();
  const client = supabaseFromEnv();
  const key = keyFromEnv();

  if (!repo || !client || !key) {
    return NextResponse.json(
      { ok: false, error: "Connecting a CRM is not set up on this deployment yet." },
      { status: 503 }
    );
  }

  let body: { url?: unknown; token?: unknown };
  try {
    body = (await request.json()) as { url?: unknown; token?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const feedToken = tokenFromInput(typeof body.url === "string" ? body.url : "");
  if (!feedToken) {
    return NextResponse.json(
      { ok: false, error: "Paste your feed URL so we know which feed to connect." },
      { status: 400 }
    );
  }

  const accessToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!accessToken) {
    return NextResponse.json({ ok: false, error: "Paste the private app token." }, { status: 400 });
  }

  const feed = await repo.findByTokenHash(await hashToken(feedToken));
  if (!feed || feed.status !== "active") {
    return NextResponse.json({ ok: false, error: "No feed found for that URL." }, { status: 404 });
  }

  const verified = await verifyAccess(new HubSpotClient({ accessToken }));
  if (!verified.ok) {
    // Nothing stored. A token that cannot read is not a connection.
    return NextResponse.json({ ok: false, error: verified.error }, { status: 400 });
  }

  try {
    await new CrmConnectionStore(client, key).save({
      feedId: feed.id,
      provider: "hubspot",
      accessToken,
      // Neither applies to a private app token, and saying so beats storing a
      // zero that a later run would read as "expired".
      refreshToken: null,
      expiresAt: null,
      scopes: "private-app",
    });
  } catch (error) {
    console.error("storing a private app token failed:", error);
    return NextResponse.json(
      { ok: false, error: "The connection could not be saved. Nothing was stored." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
