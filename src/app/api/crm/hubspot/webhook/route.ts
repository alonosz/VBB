import { NextResponse, after } from "next/server";
import { feedOriginFromEnv } from "@/lib/feed/origin";
import { feedRepositoryFromEnv, supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import { CrmConnectionStore } from "@/lib/sync/connections";
import { keyFromEnv } from "@/lib/sync/secrets";
import { oauthConfigFromEnv } from "@/lib/sync/hubspot/oauth";
import { oauthConfigFromEnv as googleOauthFromEnv } from "@/lib/sync/google/oauth";
import { handleWebhookEvents } from "@/lib/sync/hubspot/realtime";
import { parseEvents, verifyWebhook } from "@/lib/sync/hubspot/webhook";
import { SupabaseSyncRunStore } from "@/lib/sync/runs";

/**
 * Where HubSpot tells us a lead exists.
 *
 * HubSpot gives a webhook five seconds and retries anything that did not
 * answer 2xx, so the answer goes back the moment the signature checks and
 * the pricing runs after the response is on its way. A refusal is a 401 and
 * nothing else: the body is HubSpot's, and echoing it back to whoever forged
 * a request teaches them what a real one looks like.
 *
 * The response carries counts and never a lead. A webhook log is not a
 * place for someone's CRM.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const body = await request.text();
  const requestUrl = new URL(request.url);
  // Signed over the URL HubSpot called, which is the public one - never a
  // per-deployment host or whatever a proxy rewrote the scheme to.
  const url = `${feedOriginFromEnv(requestUrl.origin)}${requestUrl.pathname}`;

  const verified = verifyWebhook({
    secret,
    method: "POST",
    url,
    body,
    timestamp: request.headers.get("x-hubspot-request-timestamp"),
    signature: request.headers.get("x-hubspot-signature-v3"),
  });
  if (!verified.ok) {
    console.error(`HubSpot webhook refused: ${verified.reason}`);
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "That body could not be read." }, { status: 400 });
  }
  const events = parseEvents(payload);

  const repo = feedRepositoryFromEnv();
  const client = supabaseFromEnv();
  const key = keyFromEnv();
  if (!repo || !client || !key) {
    // Acknowledged, not retried: a deployment without a database will not
    // grow one in the next retry window, and HubSpot's ten retries would
    // only fill its log.
    console.error("HubSpot webhook received on a deployment without CRM sync configured.");
    return NextResponse.json({ ok: true, events: events.length, handled: false });
  }

  if (events.length > 0) {
    const origin = feedOriginFromEnv(requestUrl.origin);
    after(async () => {
      try {
        const outcome = await handleWebhookEvents({
          events,
          repo,
          connections: new CrmConnectionStore(client, key),
          runs: new SupabaseSyncRunStore(client),
          oauth: oauthConfigFromEnv(`${origin}/api/crm/hubspot/callback`),
          googleOauth: googleOauthFromEnv(`${origin}/api/ads/google/callback`),
        });
        if (outcome.problems.length > 0) {
          console.error("HubSpot webhook problems:", outcome.problems.join(" | "));
        }
      } catch (error) {
        console.error("HubSpot webhook handling failed:", error);
      }
    });
  }

  return NextResponse.json({ ok: true, events: events.length, handled: true });
}
