import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { oauthConfigFromEnv } from "@/lib/sync/google/oauth";
import { keyFromEnv } from "@/lib/sync/secrets";
import { inviteStoreFromEnv, workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { callerIp } from "@/lib/workspace/callerIp";
import { fetchGoogleIdentity, readSignInState, signInWithGoogle } from "@/lib/auth/google";

/**
 * Back from Google with a code and the signed state. The code becomes an
 * identity, the identity a workspace, and the workspace a one-time link
 * that the join page spends for a fresh key in this browser. Every failure
 * lands on the signup page with a sentence, never on a blank error.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = feedOriginFromEnv(url.origin);

  const failed = (reason: string, next = "/diagnostic") => {
    const back = new URL(`${origin}/signup`);
    back.searchParams.set("next", next);
    back.searchParams.set("error", reason);
    return NextResponse.redirect(back);
  };

  const oauth = oauthConfigFromEnv(`${origin}/api/auth/google/callback`);
  const key = keyFromEnv();
  const workspaces = workspaceRepositoryFromEnv();
  const invites = inviteStoreFromEnv();
  if (!oauth || !key || !workspaces || !invites) {
    return failed("Signing in with Google is not set up on this deployment yet.");
  }

  const state = url.searchParams.get("state") ?? "";
  const read = readSignInState(state, key);
  if (!read) return failed("That sign-in link has expired or was altered. Try again.");

  if (url.searchParams.get("error")) return failed("Google did not complete the sign-in.", read.next);
  const code = url.searchParams.get("code");
  if (!code) return failed("That link is incomplete. Try again.", read.next);

  const identity = await fetchGoogleIdentity(oauth, code, fetch);
  if (!identity) return failed("Google would not confirm who you are. Try again.", read.next);

  const result = await signInWithGoogle({ workspaces, invites, identity, ip: callerIp(request) });
  if (!result.ok) return failed(result.error, read.next);

  const join = new URL(`${origin}/join`);
  join.searchParams.set("t", result.inviteToken);
  join.searchParams.set("next", read.next);
  return NextResponse.redirect(join);
}
