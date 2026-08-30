import { NextResponse } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { keyFromEnv } from "@/lib/sync/secrets";
import { freshAccessToken } from "@/lib/sync/hubspot/accessToken";
import { HubSpotClient, pullFromHubSpot } from "@/lib/sync/hubspot/client";
import { currenciesInPull, hubspotToDeals } from "@/lib/sync/hubspot/map";
import { dealsToRows } from "@/lib/sync/hubspot/rows";
import { oauthConfigFromEnv } from "@/lib/sync/hubspot/oauth";

/**
 * Twelve months of deals, so step 2 can read a CRM instead of a file.
 *
 * This is the only route in the product through which CRM records pass, and
 * the shape of that matters more than the code does.
 *
 * **Nothing is stored.** The rows exist in this function's memory for the
 * length of one request and are handed to the browser, which is where every
 * other path already keeps them. No table here can hold a deal, a name or an
 * address, and the CHECK constraints would refuse them if one tried. What the
 * server keeps is what it always kept: the connection's encrypted token, and
 * later the finished values the advertiser publishes.
 *
 * The alternative was pulling from HubSpot in the browser directly, which
 * would put the customer's CRM token into their page. That is worse, and it
 * is why this route exists at all.
 *
 * The window is a year rather than the nightly sync's few days: a model is
 * fitted on history, and a 30-day window cannot see a 60-day sales cycle
 * resolve.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

/** A model needs history. Twelve months resolves all but the slowest pipelines. */
const HISTORY_DAYS = 365;

export async function POST(request: Request) {
  const origin = feedOriginFromEnv(new URL(request.url).origin);
  const workspaces = workspaceRepositoryFromEnv();
  const client = supabaseFromEnv();
  const key = keyFromEnv();

  if (!workspaces || !client || !key) {
    return NextResponse.json(
      { ok: false, error: "Reading a CRM is not set up on this deployment yet." },
      { status: 503 }
    );
  }

  let body: { workspaceKey?: unknown };
  try {
    body = (await request.json()) as { workspaceKey?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const auth = await authorizeWorkspace(workspaces, body.workspaceKey);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const connections = new CrmConnectionStore(client, key);
  const { connection, error: connectionError } = await connections.load(auth.workspace.id);
  if (!connection) {
    return NextResponse.json(
      { ok: false, error: connectionError ?? "No CRM is connected to this workspace." },
      { status: 409 }
    );
  }

  const oauth = oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`);
  const fresh = await freshAccessToken({ connections, connection, oauth });
  if (fresh.token === null) {
    return NextResponse.json({ ok: false, error: fresh.error }, { status: 409 });
  }

  try {
    const pull = await pullFromHubSpot(
      new HubSpotClient({ accessToken: fresh.token, windowDays: HISTORY_DAYS })
    );

    // Currencies before deals, because the answer changes what the amounts
    // mean. A portal reporting in three currencies converted with no rates
    // would produce a model priced in a currency that does not exist.
    const currencies = currenciesInPull(pull);
    const deals = hubspotToDeals(pull);
    const { headers, rows } = dealsToRows(deals);

    return NextResponse.json({
      ok: true,
      headers,
      rows,
      dealCount: deals.length,
      windowDays: HISTORY_DAYS,
      currencies,
    });
  } catch (error) {
    // Whatever HubSpot said is for our log, not for the advertiser: it can
    // carry object ids and property names, and none of that helps them.
    console.error("reading deals from HubSpot failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "HubSpot would not return your deals. If you have just changed permissions, " +
          "reconnect the account and try again.",
      },
      { status: 502 }
    );
  }
}
