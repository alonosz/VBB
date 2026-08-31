import { NextResponse } from "next/server";
import { adsSession, refuse } from "@/lib/sync/google/session";
import { describeAccount, checkAccount } from "@/lib/sync/google/accounts";
import { ensureConversionAction } from "@/lib/sync/google/conversionAction";
import { auditStrategies, readCampaigns } from "@/lib/sync/google/campaigns";
import {
  describeOutcome,
  uploadAdjustments,
  uploadConversions,
} from "@/lib/sync/google/upload";
import { AdsApiError, normalizeCustomerId } from "@/lib/sync/google/client";
import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { keyFromEnv } from "@/lib/sync/secrets";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { parseRows } from "@/lib/feed/handlers";

/**
 * Setting the account up and sending the values, in one call.
 *
 * The whole reason for the API route, and the thing that removes Google's
 * six-step wizard from the customer's job: we create the conversion action
 * ourselves, upload against it, and read back which campaigns are on a bid
 * strategy that will ignore everything we just sent.
 *
 * Rows arrive finished from the browser, exactly as they do for the CSV feed.
 * The server prices nothing.
 */

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  let body: {
    workspaceKey?: unknown;
    customerId?: unknown;
    currencyCode?: unknown;
    modelId?: unknown;
    rows?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("That request could not be read.");
  }

  const customerId =
    typeof body.customerId === "string" ? normalizeCustomerId(body.customerId) : null;
  if (!customerId) return bad("Pick which Google Ads account these values are for.");

  const currencyCode = typeof body.currencyCode === "string" ? body.currencyCode.trim() : "";
  if (!/^[A-Z]{3}$/.test(currencyCode)) return bad("These values need an ISO currency code.");
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  if (!modelId) return bad("A publish has to say which model priced it.");

  const session = await adsSession(request, body.workspaceKey);
  if (!session.ok) return refuse(session);

  // The same guard the CSV publish uses: anything the database would refuse is
  // refused here first, with something a person can read.
  let rows;
  try {
    rows = parseRows(body.rows, currencyCode, modelId);
  } catch (error) {
    return bad((error as Error).message);
  }
  if (rows.length === 0) return bad("There is nothing to send.");

  try {
    const account = await describeAccount(session.client, customerId);
    if (!account) return bad("We couldn't read that Google Ads account.", 404);

    /*
     * The currency check, before a single row is sent. Google accepts USD
     * values into a EUR account without complaint and then misprices every
     * lead for as long as it runs, with nothing on any screen to say so.
     */
    const usable = checkAccount(account, currencyCode);
    if (!usable.ok) return bad(usable.reason);

    const action = await ensureConversionAction(session.client, customerId);

    const conversions = await uploadConversions({
      client: session.client,
      customerId,
      conversionActionResourceName: action.resourceName,
      rows,
    });
    const adjustments = await uploadAdjustments({
      client: session.client,
      customerId,
      conversionActionResourceName: action.resourceName,
      rows,
    });

    // Remember which account this workspace sends to, so a later reconnection
    // to a different one is visible rather than silent.
    const supabase = supabaseFromEnv();
    const key = keyFromEnv();
    if (supabase && key) {
      const connections = new CrmConnectionStore(supabase, key);
      const existing = await connections.load(session.workspaceId, "google_ads");
      if (existing.connection) {
        await connections.save({
          ...existing.connection,
          externalAccountId: customerId,
        });
      }
    }

    /*
     * The last word, and the one that decides whether any of it mattered.
     * Values landing in an account whose campaigns bid on lead count change
     * nothing, and nothing in Google Ads says so.
     */
    let strategies = null;
    try {
      strategies = auditStrategies(await readCampaigns(session.client, customerId));
    } catch (error) {
      // A failure to read campaigns must not report a successful upload as a
      // failure. The advertiser simply does not get that half of the answer.
      console.error("reading campaigns after an upload failed:", error);
    }

    return NextResponse.json({
      ok: true,
      account: { customerId: account.customerId, name: account.name, displayId: account.displayId },
      conversionAction: { name: action.name, existed: action.existed },
      conversions: { ...conversions, summary: describeOutcome(conversions, "conversion") },
      adjustments: { ...adjustments, summary: describeOutcome(adjustments, "adjustment") },
      strategies,
    });
  } catch (error) {
    if (error instanceof AdsApiError) {
      console.error("Google Ads publish failed:", error.errorCode, error.message);
      return NextResponse.json(
        { ok: false, error: error.message, errorCode: error.errorCode },
        { status: error.needsReconnect ? 401 : 502 }
      );
    }
    console.error("Google Ads publish failed:", error);
    return bad("Sending the values to Google Ads failed. Nothing was changed.", 502);
  }
}
