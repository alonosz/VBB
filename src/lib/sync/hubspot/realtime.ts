import type { FeedRepository } from "@/lib/feed/repository";
import { runSync } from "../run";
import type { SyncRunStore } from "../runs";
import { CrmConnectionStore } from "../connections";
import type { OAuthConfig } from "../oauth/tokens";
import {
  DEFAULT_WINDOW_DAYS,
  HubSpotClient,
  HubSpotError,
  contactIdsOfDeals,
  discoverPortal,
  readLeads,
  type PortalVocabulary,
} from "./client";
import { hubspotToDeals } from "./map";
import { freshAccessToken } from "./accessToken";
import { deliverToGoogle } from "./syncFeed";
import type { WebhookEvent } from "./webhook";

/**
 * A lead priced the moment it exists.
 *
 * The nightly run reads a window and prices everything in it. This reads
 * the handful of records a webhook just named and prices only those, on
 * the same saved model, through the same row builder, into the same feeds,
 * and sends an api feed's new rows to Google before returning. What it
 * changes is when, not what: a lead that arrived at three in the afternoon
 * is worth the same amount it would have been worth at six the next
 * morning, and Google hears about it fifteen hours sooner.
 *
 * Everything here is idempotent on purpose. HubSpot retries a delivery it
 * did not get a 2xx for, and a webhook can name a contact the night's run
 * already priced. A row that exists is not added again and a row Google
 * already has is not resent, because both are keyed on the lead's identity.
 * So a repeat costs a read and nothing else, and the nightly run stays the
 * sweep for anything this missed.
 */

export interface RealtimeOptions {
  events: WebhookEvent[];
  repo: FeedRepository;
  connections: CrmConnectionStore;
  runs?: SyncRunStore;
  oauth?: OAuthConfig | null;
  googleOauth?: OAuthConfig | null;
  fetchImpl?: typeof fetch;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * What a portal calls things, kept for a few minutes per workspace. A burst
 * of events reads the property definitions once instead of once per event.
 * Per process only - a serverless instance forgets it, which is fine.
 */
const VOCABULARY_TTL_MS = 10 * 60_000;
const vocabularies = new Map<string, { at: number; value: PortalVocabulary }>();

async function vocabularyFor(workspaceId: string, client: HubSpotClient, now: Date): Promise<PortalVocabulary> {
  const cached = vocabularies.get(workspaceId);
  if (cached && now.getTime() - cached.at < VOCABULARY_TTL_MS) return cached.value;
  const value = await discoverPortal(client);
  vocabularies.set(workspaceId, { at: now.getTime(), value });
  return value;
}

export interface RealtimeOutcome {
  portals: number;
  workspaces: number;
  leadsRead: number;
  rowsAdded: number;
  sent: number;
  /** Anything that stopped a portal or a feed being priced, in words. */
  problems: string[];
}

export async function handleWebhookEvents(opts: RealtimeOptions): Promise<RealtimeOutcome> {
  const { connections } = opts;
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const outcome: RealtimeOutcome = { portals: 0, workspaces: 0, leadsRead: 0, rowsAdded: 0, sent: 0, problems: [] };

  const byPortal = new Map<string, WebhookEvent[]>();
  for (const event of opts.events) {
    byPortal.set(event.portalId, [...(byPortal.get(event.portalId) ?? []), event]);
  }

  for (const [portalId, events] of byPortal) {
    outcome.portals++;
    const workspaceIds = await connections.workspacesForExternalAccount("hubspot", portalId);
    if (workspaceIds.length === 0) {
      // A portal we were never told about. Not an error to HubSpot - the app
      // is installed there - but nobody here asked to price its leads.
      outcome.problems.push(`Portal ${portalId} is not connected to any workspace.`);
      continue;
    }

    for (const workspaceId of workspaceIds) {
      outcome.workspaces++;
      try {
        await priceForWorkspace({ workspaceId, events, opts, now, fetchImpl, outcome });
      } catch (error) {
        const why = error instanceof HubSpotError ? error.message : "The CRM could not be read.";
        outcome.problems.push(`Workspace ${workspaceId}: ${why}`);
        await connections.recordRun(workspaceId, "hubspot", { status: "failed", error: why, at: now });
      }
    }
  }

  return outcome;
}

async function priceForWorkspace(args: {
  workspaceId: string;
  events: WebhookEvent[];
  opts: RealtimeOptions;
  now: Date;
  fetchImpl: typeof fetch;
  outcome: RealtimeOutcome;
}): Promise<void> {
  const { workspaceId, events, opts, now, fetchImpl, outcome } = args;
  const { repo, connections } = opts;

  const { connection, error } = await connections.load(workspaceId, "hubspot");
  if (!connection) {
    outcome.problems.push(`Workspace ${workspaceId}: ${error ?? "no CRM connection."}`);
    return;
  }

  const fresh = await freshAccessToken({ connections, connection, oauth: opts.oauth ?? null, fetchImpl, now });
  if (fresh.token === null) {
    outcome.problems.push(`Workspace ${workspaceId}: ${fresh.error}`);
    await connections.recordRun(workspaceId, "hubspot", { status: "refused", error: fresh.error, at: now });
    return;
  }

  const client = new HubSpotClient({ accessToken: fresh.token, fetchImpl, now, sleep: opts.sleep });

  // A deal event names its contacts through the deal; a contact event names
  // itself. Both end up as the same thing: leads to read.
  const contactIds = new Set(events.filter((e) => e.object === "contact").map((e) => e.objectId));
  const dealIds = events.filter((e) => e.object === "deal").map((e) => e.objectId);
  for (const id of await contactIdsOfDeals(client, dealIds)) contactIds.add(id);
  if (contactIds.size === 0) return;

  // CRM records live here, in memory, for the length of this call. Only
  // contacts of the window are leads: a deal event on an old contact must
  // not turn it into a conversion dated years ago.
  const since = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  const pull = await readLeads(client, [...contactIds], {
    since,
    vocabulary: await vocabularyFor(workspaceId, client, now),
  });
  outcome.leadsRead += pull.leads?.length ?? 0;
  if ((pull.leads?.length ?? 0) === 0) return;

  for (const feed of await repo.listForWorkspace(workspaceId)) {
    if (feed.status !== "active") continue;

    const { model, error: modelError } = await repo.modelFor(feed.id);
    if (!model) {
      outcome.problems.push(`Feed ${feed.id}: ${modelError ?? "no saved model."}`);
      continue;
    }

    const deals = hubspotToDeals(pull, {
      reportingCurrency: feed.currencyCode,
      rates: {},
      excludeUnconvertible: true,
    });
    const report = await runSync({ repo, feed, model, deals, now, partial: true });
    outcome.rowsAdded += report.rowsAdded;

    if (!report.refusedBecause && feed.delivery === "api") {
      report.delivery = await deliverToGoogle({
        feed, workspaceId, repo, connections, googleOauth: opts.googleOauth, fetchImpl, now,
      });
      outcome.sent += report.delivery.sent;
      if (report.delivery.error) outcome.problems.push(`Feed ${feed.id}: ${report.delivery.error}`);
    }

    const problem = report.refusedBecause ?? report.delivery?.error ?? null;
    const status = report.refusedBecause ? "refused" : problem ? "failed" : "ok";
    await connections.recordRun(workspaceId, "hubspot", { status, rows: report.rowsAdded, error: problem, at: now });
    // A run that added nothing and failed nothing is a repeat delivery, and
    // a log full of those would bury the night's one line that matters.
    if (report.rowsAdded > 0 || problem) {
      await opts.runs?.record({
        feedId: feed.id,
        clientId: feed.clientId,
        status,
        startedAt: now,
        finishedAt: new Date(),
        message: problem ?? `Live from HubSpot: ${contactIds.size} ${contactIds.size === 1 ? "lead" : "leads"}.`,
        report,
      });
    }
  }
}
