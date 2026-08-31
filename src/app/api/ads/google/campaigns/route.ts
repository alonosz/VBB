import { NextResponse } from "next/server";
import { adsSession, refuse } from "@/lib/sync/google/session";
import { auditStrategies, readCampaigns } from "@/lib/sync/google/campaigns";
import { AdsApiError, normalizeCustomerId } from "@/lib/sync/google/client";

/**
 * Are the campaigns actually bidding on the values we send?
 *
 * The publish route already answers this, once, as the last line of a send.
 * That is the wrong moment for it to be the only answer: a bid strategy is a
 * setting somebody can change back on a Tuesday, and the advertiser finds out
 * by their results going quiet. This route asks the same question on demand,
 * without sending anything, so the evaluation screen can keep asking it.
 *
 * Read-only by construction. It cannot upload, cannot create a conversion
 * action, and cannot change an account: it runs one GAQL query and reports
 * what came back.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { workspaceKey?: unknown; customerId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "That request could not be read." },
      { status: 400 }
    );
  }

  const session = await adsSession(request, body.workspaceKey);
  if (!session.ok) return refuse(session);

  /*
   * The account this workspace last published to, unless the caller names
   * one. Asking somebody to pick their account again to read a report they
   * already published to would be a question we know the answer to.
   */
  const asked =
    typeof body.customerId === "string" ? normalizeCustomerId(body.customerId) : null;
  const customerId = asked ?? session.connectedAccountId;
  if (!customerId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Your Google Ads account is connected but nothing has been sent to it yet, " +
          "so we don't know which account to read.",
      },
      { status: 409 }
    );
  }

  try {
    const strategies = auditStrategies(await readCampaigns(session.client, customerId));
    return NextResponse.json({ ok: true, customerId, strategies });
  } catch (error) {
    const message =
      error instanceof AdsApiError
        ? error.message
        : "We couldn't read your campaigns from Google Ads.";
    console.error("reading campaign bid strategies failed:", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof AdsApiError && error.needsReconnect ? 401 : 502 }
    );
  }
}
