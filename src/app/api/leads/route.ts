import { NextResponse } from "next/server";
import { supabaseFromEnv } from "@/lib/feed/supabaseRepository";
import {
  cleanStep,
  hashCaller,
  isLeadSource,
  looksLikeEmail,
  MAX_PER_CALLER_PER_HOUR,
  normalizeEmail,
  RATE_WINDOW_MS,
  SupabaseLeadStore,
} from "@/lib/leads/leads";

/**
 * Somebody left their address.
 *
 * Open by design: this is the one route in the product a stranger is meant to
 * be able to call, because the whole point is reaching people before they are
 * customers. Three things follow from that.
 *
 * It stores nothing derived from their file. The body carries an address, a
 * source and a step label; there is no field for a figure and the schema has
 * nowhere to put one.
 *
 * It answers the same way whatever happens. A first submission, a repeat, an
 * address we already have, a rate limit and a database that is down all return
 * the same body. An endpoint that says "already on the list" is an endpoint
 * that tells anyone who asks whether a given person uses this product.
 *
 * And it never blocks the page. Nothing downstream of this box depends on it,
 * so a failure is logged and the visitor is thanked, because the alternative
 * is an error message about our database in the middle of someone's evaluation.
 */

export const runtime = "nodejs";

/** Every path answers with this. See above: the sameness is the feature. */
const THANKS = { ok: true } as const;

function callerIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export async function POST(request: Request) {
  let body: { email?: unknown; source?: unknown; step?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const raw = typeof body.email === "string" ? body.email : "";

  // The one thing worth saying out loud, because it is the one thing they can
  // fix while the box is still in front of them.
  if (!looksLikeEmail(raw)) {
    return NextResponse.json(
      { ok: false, error: "That does not look like an email address." },
      { status: 400 }
    );
  }

  const source = isLeadSource(body.source) ? body.source : "flow";
  const email = normalizeEmail(raw);
  const step = cleanStep(body.step);

  const client = supabaseFromEnv();
  if (!client) {
    // Not configured is not the visitor's problem, and telling them the
    // deployment is half-built helps nobody. Log it for whoever deployed.
    console.error("A lead was submitted but Supabase is not configured on this deployment.");
    return NextResponse.json(THANKS);
  }

  try {
    const store = new SupabaseLeadStore(client);

    // Salted with the source, so the same visitor filling in two different
    // boxes counts separately. One person leaving their address at the report
    // and again on the landing page is not abuse.
    const ipHash = await hashCaller(callerIp(request), source);
    const since = new Date(Date.now() - RATE_WINDOW_MS);

    if (await store.countSince(ipHash, since) >= MAX_PER_CALLER_PER_HOUR) {
      return NextResponse.json(THANKS);
    }

    await store.record({ email, source, furthestStep: step, ipHash });
  } catch (error) {
    console.error("Could not record a lead:", error);
  }

  return NextResponse.json(THANKS);
}
