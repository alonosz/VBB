import { NextResponse } from "next/server";
import { adsSession, refuse } from "@/lib/sync/google/session";
import { readReadiness } from "@/lib/sync/google/readiness";
import { AdsApiError } from "@/lib/sync/google/client";

/**
 * What is wrong with the account, asked before anything is sent to it.
 *
 * Read-only, and deliberately its own route rather than folded into the
 * account listing: the listing answers for every account a login can reach,
 * and this is one query against the one account they picked. Running it for
 * all of them would be a dozen calls to answer a question about one.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { workspaceKey?: unknown; customerId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  if (!customerId) {
    return NextResponse.json({ ok: false, error: "No account was chosen." }, { status: 400 });
  }

  const session = await adsSession(request, body.workspaceKey);
  if (!session.ok) return refuse(session);

  try {
    return NextResponse.json({
      ok: true,
      readiness: await readReadiness(session.client, customerId),
    });
  } catch (error) {
    /*
     * A failed check must never read as a failed account. This runs before the
     * advertiser has done anything wrong, and reporting our own outage as
     * their misconfiguration would send them into Google Ads to fix nothing.
     */
    const message =
      error instanceof AdsApiError
        ? error.message
        : "We couldn't read this account's conversion settings.";
    console.error("reading Google Ads readiness failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
