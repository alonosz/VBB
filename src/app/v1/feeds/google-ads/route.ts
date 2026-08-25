import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { serveFeed } from "@/lib/feed/handlers";

/**
 * The tokenized feed Google fetches on a schedule.
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
    token: new URL(request.url).searchParams.get("key"),
    userAgent: request.headers.get("user-agent"),
    ip: callerIp(request),
  });

  return new NextResponse(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
