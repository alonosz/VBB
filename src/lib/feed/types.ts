/**
 * The feed domain.
 *
 * Everything here is what Google fetches and nothing more. A lead exists in
 * this half of the product as a hashed identifier, a timestamp and a value —
 * the CRM data that produced the value stays in the browser.
 */

import type { SavedValueModel } from "@/lib/model/savedModel";

/**
 * Google's Click Conversion Import carries one identifier type per file, so a
 * feed picks one at publish and keeps it. Inferring it per row would produce a
 * file whose columns don't match Google's template, which is rejected whole.
 */
export type FeedIdentifier = "clickId" | "email";

export type FeedRowKind = "conversion" | "adjustment";

export interface FeedRow {
  /** SHA-256 of the lowercased, trimmed address. Never the address. */
  hashedEmail: string | null;
  /** gclid / gbraid / wbraid. */
  clickId: string | null;
  /** Day-0: when the lead arrived, never when we processed it. */
  conversionTime: Date;
  value: number;
  currencyCode: string;
  modelId: string;
  kind: FeedRowKind;
  /** Stable identity for one lead's conversion, so republishing cannot duplicate it. */
  rowKey: string;
}

export interface FeedRecord {
  id: string;
  /** The workspace that owns it. Every feed has one. */
  clientId: string;
  tokenPrefix: string;
  label: string | null;
  modelId: string;
  modelFittedAt: Date | null;
  currencyCode: string;
  identifier: FeedIdentifier;
  status: "active" | "revoked";
  createdAt: Date;
  publishedAt: Date | null;
  rowsPublished: number;
}

export interface NewFeed {
  /** Required: a feed with no owner cannot be listed, supported or isolated. */
  clientId: string;
  tokenHash: string;
  tokenPrefix: string;
  label?: string | null;
  modelId: string;
  modelFittedAt?: Date | null;
  currencyCode: string;
  identifier: FeedIdentifier;
}

export interface FetchLogEntry {
  status: number;
  rowCount: number;
  userAgent: string | null;
  /** Hashed for the same reason emails are. */
  ipHash: string | null;
}

/** One logged fetch, read back. The hashed IP is deliberately not carried. */
export interface FetchRecord {
  fetchedAt: Date;
  status: number;
  rowCount: number;
  userAgent: string | null;
}

// ---------------------------------------------------------------------------
// The guard both storage paths share
// ---------------------------------------------------------------------------

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * What the database CHECK constraints enforce, enforced again in code.
 *
 * Not belt and braces for its own sake: the in-memory repository used by tests
 * would otherwise happily accept a row Postgres would reject, and the tests
 * would be describing a system that does not exist.
 */
export function assertStorableRow(row: FeedRow): void {
  if (!row.hashedEmail && !row.clickId) {
    throw new Error("A feed row needs a hashed email or a click ID to be joinable to a click.");
  }
  if (row.hashedEmail !== null && !SHA256_HEX.test(row.hashedEmail)) {
    throw new Error("A feed row's email must be a SHA-256 hash — an address must never be stored.");
  }
  if (row.clickId !== null && (row.clickId.includes("@") || row.clickId.length < 8)) {
    throw new Error("A feed row's click ID must be an ad click token, not a contact detail.");
  }
  if (!(row.value > 0)) {
    throw new Error("A feed row's value must be above zero — never tell Google a lead was worthless.");
  }
  if (!/^[A-Z]{3}$/.test(row.currencyCode)) {
    throw new Error("A feed row needs an ISO currency code.");
  }
  if (Number.isNaN(row.conversionTime.getTime())) {
    throw new Error("A feed row needs a real conversion time.");
  }
}

/**
 * The same refusal for a saved model, mirroring the feed_models CHECK
 * constraints so the in-memory repository cannot accept a model Postgres would
 * reject.
 *
 * The address check is the one that matters. Everything else in a saved model
 * is an aggregate over at least a level's worth of deals; a level *label*,
 * though, is a string from the advertiser's CRM, and a mismapped column could
 * put a contact detail there. The database refuses it, so this does too.
 */
export function assertStorableModel(model: SavedValueModel): void {
  if (!(model.baseValue > 0)) {
    throw new Error("A saved model needs a base value above zero, or it prices every lead at nothing.");
  }
  if (!/^[A-Z]{3}$/.test(model.currencyCode)) {
    throw new Error("A saved model needs an ISO currency code.");
  }
  if (model.formatVersion <= 0) {
    throw new Error("A saved model needs a format version.");
  }
  const serialized = JSON.stringify(model);
  if (serialized.includes("@")) {
    throw new Error(
      "A saved model must not contain an email address. A level label carrying one usually means a column was mapped to the wrong field."
    );
  }
  if (serialized.length >= 262_144) {
    throw new Error("That is too large to be a saved model.");
  }
}
