import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { keyFromEnv } from "@/lib/sync/secrets";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeOrCreateWorkspace } from "@/lib/workspace/selfServe";
import { authorizeUrl, oauthConfigFromEnv, signState } from "@/lib/sync/google/oauth";

/**
 * Starting a Google Ads connection.
 *
 * POST, and the browser follows what comes back, for the same reason the
 * HubSpot one is a POST: a GET would put the workspace key in a URL, where it
 * reaches the server log, the browser history and the referrer header on the
 * way out to Google. That key is the whole credential for the workspace.
 */

function callerIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const oauth = oauthConfigFromEnv(`${origin}/api/ads/google/callback`);
  const key = keyFromEnv();
  const workspaces = workspaceRepositoryFromEnv();

  // One sentence for the advertiser, the actual missing setting in the log for
  // whoever deployed it. A VBB_TOKEN_KEY under 24 characters is refused rather
  // than padded, and from out here that looks identical to having no database.
  if (!oauth || !key || !workspaces) {
    const missing = Object.entries({
      "workspace store": workspaces,
      "GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET": oauth,
      "VBB_TOKEN_KEY (64 hex, base64 of 32 bytes, or 24+ characters)": key,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);

    console.error(`Cannot connect Google Ads: not configured - ${missing.join(", ")}`);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Connecting Google Ads is not set up on this deployment yet. Whoever " +
          "deployed it can see which setting is missing in the server log.",
      },
      { status: 503 }
    );
  }

  let body: { workspaceKey?: unknown };
  try {
    body = (await request.json()) as { workspaceKey?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const auth = await authorizeOrCreateWorkspace({
    repo: workspaces,
    presented: body.workspaceKey,
    ip: callerIp(request),
  });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  // The workspace id travels through Google, signed. No credential travels.
  return NextResponse.json({
    ok: true,
    authorizeUrl: authorizeUrl(oauth, signState(auth.workspace.id, key)),
    // The one moment a minted key exists outside a hash. The browser has to
    // keep it now or the workspace becomes unreachable.
    ...(auth.mintedKey ? { workspaceKey: auth.mintedKey } : {}),
  });
}
