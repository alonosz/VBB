import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { oauthConfigFromEnv } from "@/lib/sync/google/oauth";
import { keyFromEnv } from "@/lib/sync/secrets";
import { signInState, signInUrl } from "@/lib/auth/google";
import { safeNext } from "@/lib/workspace/signup";

/**
 * The "Sign up with Google" button. Sends the browser to Google with the
 * return path signed into the state, so the callback knows where to put
 * them back and nobody can point it somewhere else.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = feedOriginFromEnv(url.origin);
  const next = safeNext(url.searchParams.get("next"));

  const oauth = oauthConfigFromEnv(`${origin}/api/auth/google/callback`);
  const key = keyFromEnv();
  if (!oauth || !key) {
    const back = new URL(`${origin}/signup`);
    back.searchParams.set("next", next);
    back.searchParams.set("error", "Signing in with Google is not set up on this deployment yet.");
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(signInUrl(oauth, signInState(next, key)));
}
