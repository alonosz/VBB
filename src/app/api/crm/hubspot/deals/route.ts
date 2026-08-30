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

/**
 * Which piece of the configuration is missing, for the log.
 *
 * The advertiser gets one sentence, deliberately: a stranger poking at this
 * route should not be handed a list of what this deployment has and has not
 * configured. Whoever deployed it needs the opposite, and they can read the
 * platform log, so the detail goes there.
 *
 * This existed as a bare boolean check and cost an evening. "Reading a CRM is
 * not set up on this deployment yet" is true and useless: the commonest cause
 * by far is a VBB_TOKEN_KEY under 24 characters, which is refused rather than
 * padded and looks from the outside exactly like Supabase being absent.
 */
function missingConfig(parts: Record<string, unknown>): string[] {
  return Object.entries(parts)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

/** Named here so the log says the variable, not the internal helper. */
const TOKEN_KEY_HINT =
  "VBB_TOKEN_KEY (must be 64 hex characters, base64 decoding to 32 bytes, " +
  "or a passphrase of at least 24 characters - anything shorter is refused)";

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
    const missing = missingConfig({
      Supabase: client,
      "workspace store": workspaces,
      [TOKEN_KEY_HINT]: key,
    });
    console.error(`Cannot read a CRM: not configured - ${missing.join(", ")}`);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Reading a CRM is not set up on this deployment yet. Whoever deployed it " +
          "can see which setting is missing in the server log.",
      },
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
  const { connection, error: connectionError } = await connections.load(auth.workspace.id, "hubspot");
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
