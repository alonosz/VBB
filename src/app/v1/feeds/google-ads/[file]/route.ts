import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { serveFeed } from "@/lib/feed/handlers";

/**
 * The feed URL Google Ads will actually accept.
 *
 * Google's HTTPS data source validates the file extension from the end of the
 * URL, and rejects anything that does not finish in .csv or .tsv — a query
 * string on the end fails with "Unable to read file format". So the token moves
 * into the path and the URL ends in .csv:
 *
 *   /v1/feeds/google-ads/vbb_live_xxxxx.csv
 *
 * Google's connection form also asks for a username and password. Those are
 * HTTP Basic credentials, so the token is accepted there too — letting an
 * advertiser keep it out of the URL entirely if they would rather.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callerIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

/** Basic auth, where Google puts the credentials it asks for on its form. */
export function tokenFromBasicAuth(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;

  const encoded = header.slice(6).trim();
  // Node's base64 decoder does not throw on malformed input, it returns
  // mojibake — which would then be handed on as if it were a token. So the
  // encoding is checked before it is trusted.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;

  const password = decoded.slice(separator + 1).trim();
  // A credential is printable ASCII. Anything else is a failed decode.
  if (!password || !/^[\x20-\x7E]+$/.test(password)) return null;
  return password;
}

/** Strips the extension Google requires, leaving the token. */
export function tokenFromFilename(file: string): string | null {
  const name = decodeURIComponent(file).replace(/\.(csv|tsv)$/i, "");
  return name.trim() || null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const repo = feedRepositoryFromEnv();
  if (!repo) {
    return new NextResponse("This feed is not configured.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { file } = await params;
  const result = await serveFeed(repo, {
    // The path is the normal way in; Basic auth and the legacy query parameter
    // both still work, so a URL saved before this change keeps running.
    token:
      tokenFromFilename(file) ??
      tokenFromBasicAuth(request.headers.get("authorization")) ??
      new URL(request.url).searchParams.get("key"),
    userAgent: request.headers.get("user-agent"),
    ip: callerIp(request),
  });

  return new NextResponse(result.body, { status: result.status, headers: result.headers });
}
