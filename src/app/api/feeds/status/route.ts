import { NextResponse } from "next/server";
import { feedRepositoryFromEnv } from "@/lib/feed/supabaseRepository";
import { feedStatus } from "@/lib/feed/handlers";
import { tokenFromInput } from "@/lib/feed/token";

/**
 * Whether Google has actually collected a feed.
 *
 * A POST rather than a GET because the feed key is the credential, and a key
 * in a query string ends up in browser history, referrer headers and every
 * access log between here and the client.
 *
 * Nothing here is logged as a fetch. Looking at the status must not spend the
 * rate-limit budget the platform needs to do its job.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const repo = feedRepositoryFromEnv();
  if (!repo) {
    return NextResponse.json(
      { ok: false, error: "Feeds are not set up on this deployment yet." },
      { status: 503 }
    );
  }

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const raw = typeof body.url === "string" ? body.url : "";
  const token = tokenFromInput(raw);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "That doesn't look like a feed URL. Paste the whole link, ending in .csv." },
      { status: 400 }
    );
  }

  const result = await feedStatus(repo, token);
  return new NextResponse(result.body, { status: result.status, headers: result.headers });
}
