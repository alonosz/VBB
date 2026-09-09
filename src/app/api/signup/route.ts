import { NextResponse } from "next/server";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { callerIp } from "@/lib/workspace/callerIp";
import { completeSignup } from "@/lib/workspace/signup";

/**
 * The signup, which is a name and an address on the workspace this browser
 * holds, or on a new one. No password is set and nothing is verified yet;
 * the key that opens the workspace still lives only in the browser, and the
 * address is what will let the advertiser back in from anywhere once links
 * can be sent.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workspaces = workspaceRepositoryFromEnv();
  if (!workspaces) {
    return NextResponse.json({ ok: false, error: "Signing up is not set up on this deployment yet." }, { status: 503 });
  }

  let body: { name?: unknown; email?: unknown; workspaceKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const result = await completeSignup({
    repo: workspaces,
    presented: body.workspaceKey,
    ip: callerIp(request),
    name: body.name,
    email: body.email,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    name: result.name,
    email: result.email,
    // The one moment a minted key exists outside a hash. The browser has to
    // keep it now or the workspace becomes unreachable.
    ...(result.mintedKey ? { workspaceKey: result.mintedKey } : {}),
  });
}
