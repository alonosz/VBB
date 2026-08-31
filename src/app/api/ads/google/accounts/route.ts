import { NextResponse } from "next/server";
import { adsSession, refuse } from "@/lib/sync/google/session";
import { listAccounts, usableAccounts } from "@/lib/sync/google/accounts";
import { AdsApiError } from "@/lib/sync/google/client";

/**
 * Which Google Ads accounts can this login reach?
 *
 * So the advertiser picks their account from a list of names rather than
 * going to find a ten digit number. An agency login sees dozens, and typing
 * the wrong one sends a year of conversion values into somebody else's
 * account.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { workspaceKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const session = await adsSession(request, body.workspaceKey);
  if (!session.ok) return refuse(session);

  try {
    const { accounts, unreadable } = await listAccounts(session.client);
    return NextResponse.json({
      ok: true,
      accounts,
      // Split rather than filtered, so a login that only reaches manager
      // accounts is told that rather than shown an empty list.
      usable: usableAccounts(accounts).map((a) => a.customerId),
      unreadable,
      connectedAccountId: session.connectedAccountId,
    });
  } catch (error) {
    const message =
      error instanceof AdsApiError
        ? error.message
        : "We couldn't read your Google Ads accounts.";
    console.error("listing Google Ads accounts failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
