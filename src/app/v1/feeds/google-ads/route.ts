import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { serveFeed } from "@/lib/feed/handlers";
import { tokenFromBasicAuth } from "./[file]/route";

/**
 * The original feed URL, kept working.
 *
 * Google Ads rejects this shape - it validates the file extension off the end
 * of the URL - so new feeds are handed out as /v1/feeds/google-ads/<token>.csv.
 * This stays for any URL saved before that, and for anything fetching the feed
 * that does not care about extensions.
 *
 * No OAuth and no Sheets API: the advertiser pastes this URL into Google Ads
 * once, and Google pulls the file once or twice a day. The token in the query
 * string is the whole credential, which is why it is stored only as a hash,
 * rate limited, and logged on every fetch.
 *
 * Nothing here computes a value. The rows were priced in the browser by a model
 * the advertiser approved and published; this reads them out.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callerIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export async function GET(request: Request) {
  const repo = feedRepositoryFromEnv();
  if (!repo) {
    return new NextResponse("This feed is not configured.\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const result = await serveFeed(repo, {
    token:
      new URL(request.url).searchParams.get("key") ??
      tokenFromBasicAuth(request.headers.get("authorization")),
    userAgent: request.headers.get("user-agent"),
    ip: callerIp(request),
  });

  return new NextResponse(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
