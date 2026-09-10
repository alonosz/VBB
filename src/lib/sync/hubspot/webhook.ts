import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What HubSpot sends the moment something happens in a portal, and how we
 * know it was HubSpot.
 *
 * The signature is v3: a base64 HMAC-SHA256 over method, the exact URL it
 * called, the raw body and the request timestamp, keyed on the app's client
 * secret. The timestamp is what stops a captured request being replayed
 * next week; HubSpot's own tolerance is five minutes and so is ours.
 *
 * Events are parsed loosely on purpose. HubSpot has two vocabularies for
 * the same thing - the legacy `contact.creation` and the newer
 * `object.creation` with an object type id - and a portal can be on either.
 * Anything not a contact or a deal being created or changed is dropped,
 * because nothing else moves a value.
 */

export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function signatureV3(
  secret: string,
  method: string,
  url: string,
  body: string,
  timestamp: string
): string {
  return createHmac("sha256", secret)
    .update(`${method.toUpperCase()}${url}${body}${timestamp}`)
    .digest("base64");
}

export type WebhookRefusal = "unsigned" | "stale" | "mismatch";

export function verifyWebhook(opts: {
  secret: string;
  method: string;
  url: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  now?: Date;
}): { ok: true } | { ok: false; reason: WebhookRefusal } {
  const now = opts.now ?? new Date();
  if (!opts.timestamp || !opts.signature) return { ok: false, reason: "unsigned" };

  const sentAt = Number(opts.timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() - sentAt) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: "stale" };
  }

  const expected = Buffer.from(signatureV3(opts.secret, opts.method, opts.url, opts.body, opts.timestamp));
  const given = Buffer.from(opts.signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

export interface WebhookEvent {
  eventId: string;
  portalId: string;
  object: "contact" | "deal";
  objectId: string;
  change: "created" | "changed";
  /** The property that changed, on a change. */
  property: string | null;
  occurredAt: Date | null;
}

/** HubSpot's object type ids, for the newer event vocabulary. */
const OBJECT_TYPES: Record<string, WebhookEvent["object"]> = {
  "0-1": "contact",
  "0-3": "deal",
  contact: "contact",
  deal: "deal",
};

function objectOf(raw: Record<string, unknown>): WebhookEvent["object"] | null {
  const type = String(raw.subscriptionType ?? "");
  const legacy = type.split(".")[0];
  if (legacy in OBJECT_TYPES) return OBJECT_TYPES[legacy];
  const id = raw.objectTypeId === undefined ? "" : String(raw.objectTypeId);
  return OBJECT_TYPES[id] ?? null;
}

function changeOf(raw: Record<string, unknown>): WebhookEvent["change"] | null {
  const type = String(raw.subscriptionType ?? "");
  if (type.endsWith(".creation")) return "created";
  if (type.endsWith(".propertyChange")) return "changed";
  return null;
}

export function parseEvents(payload: unknown): WebhookEvent[] {
  if (!Array.isArray(payload)) return [];
  const out: WebhookEvent[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const object = objectOf(raw);
    const change = changeOf(raw);
    const objectId = raw.objectId === undefined || raw.objectId === null ? "" : String(raw.objectId);
    const portalId = raw.portalId === undefined || raw.portalId === null ? "" : String(raw.portalId);
    if (!object || !change || !objectId || !portalId) continue;
    const occurred = Number(raw.occurredAt);
    out.push({
      eventId: raw.eventId === undefined ? `${portalId}:${objectId}:${change}` : String(raw.eventId),
      portalId,
      object,
      objectId,
      change,
      property: typeof raw.propertyName === "string" ? raw.propertyName : null,
      occurredAt: Number.isFinite(occurred) && occurred > 0 ? new Date(occurred) : null,
    });
  }
  return out;
}
