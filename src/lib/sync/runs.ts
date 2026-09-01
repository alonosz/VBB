import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunCoverage, SyncReport } from "./run";

/**
 * The record of what the scheduled job did.
 *
 * The connection already carries the last run's outcome, which answers "did
 * last night work" and nothing else. The failure that quietly ends a pilot is
 * different: the cron stops firing altogether - a dropped schedule, a rotated
 * secret, a deploy that removed it - and the last-sync timestamp simply stops
 * moving. Nobody notices a field that does not change.
 *
 * A run that happens leaves a row. A run that should have happened and did not
 * leaves a gap, and a gap can be seen: "the last run was three days ago" is a
 * sentence the workspace page can say, and a stale timestamp is not.
 */

export type RunStatus = "ok" | "refused" | "failed";

export interface SyncRun {
  id: number;
  feedId: string | null;
  clientId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  status: RunStatus;
  dealsPulled: number;
  rowsPublished: number;
  newConversions: number;
  adjustments: number;
  recalibrationOnly: number;
  unchanged: number;
  skipped: number;
  message: string | null;
  modelId: string | null;
  /**
   * Null on a run recorded before coverage was measured, and on a refusal.
   * Not zero: zero would say every lead that night was unmatchable, which is
   * a number we would have made up.
   */
  coverage: RunCoverage | null;
}

export interface RecordRun {
  feedId: string | null;
  clientId: string | null;
  status: RunStatus;
  startedAt: Date;
  finishedAt?: Date;
  message?: string | null;
  modelId?: string | null;
  report?: SyncReport | null;
}

/** An error is for a person to read, not somewhere a stack trace accumulates. */
const MAX_MESSAGE = 500;

interface RunDto {
  id: number;
  feed_id: string | null;
  client_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  deals_pulled: number;
  rows_published: number;
  new_conversions: number;
  adjustments: number;
  recalibration_only: number;
  unchanged: number;
  skipped: number;
  message: string | null;
  model_id: string | null;
  leads_with_click_id: number | null;
  leads_with_email: number | null;
  leads_with_neither: number | null;
}

const COLUMNS =
  "id, feed_id, client_id, started_at, finished_at, status, deals_pulled, rows_published, new_conversions, adjustments, recalibration_only, unchanged, skipped, message, model_id, leads_with_click_id, leads_with_email, leads_with_neither";

function toRun(dto: RunDto): SyncRun {
  return {
    id: dto.id,
    feedId: dto.feed_id,
    clientId: dto.client_id,
    startedAt: new Date(dto.started_at),
    finishedAt: dto.finished_at ? new Date(dto.finished_at) : null,
    status: dto.status,
    dealsPulled: dto.deals_pulled,
    rowsPublished: dto.rows_published,
    newConversions: dto.new_conversions,
    adjustments: dto.adjustments,
    recalibrationOnly: dto.recalibration_only,
    unchanged: dto.unchanged,
    skipped: dto.skipped,
    message: dto.message,
    modelId: dto.model_id,
    /*
     * All three or none. A row with a click count and no total is a partial
     * write we should not try to interpret, and reading it as coverage would
     * put a fabricated percentage on the screen.
     */
    coverage:
      dto.leads_with_click_id === null ||
      dto.leads_with_email === null ||
      dto.leads_with_neither === null
        ? null
        : {
            clicks: dto.leads_with_click_id,
            emails: dto.leads_with_email,
            neither: dto.leads_with_neither,
            total: dto.deals_pulled,
          },
  };
}

export interface SyncRunStore {
  record(run: RecordRun): Promise<void>;
  recentForWorkspace(clientId: string, limit: number): Promise<SyncRun[]>;
}

export class SupabaseSyncRunStore implements SyncRunStore {
  constructor(private client: SupabaseClient) {}

  async record(run: RecordRun): Promise<void> {
    const report = run.report;
    const skipped = report?.skipped.reduce((sum, s) => sum + s.count, 0) ?? 0;

    const { error } = await this.client.from("sync_runs").insert({
      feed_id: run.feedId,
      client_id: run.clientId,
      started_at: run.startedAt.toISOString(),
      finished_at: (run.finishedAt ?? new Date()).toISOString(),
      status: run.status,
      deals_pulled: report?.dealsPulled ?? 0,
      rows_published: report?.rowsAdded ?? 0,
      new_conversions: report?.newConversions ?? 0,
      adjustments: report?.adjustments ?? 0,
      recalibration_only: report?.recalibrationOnly ?? 0,
      unchanged: report?.unchanged ?? 0,
      skipped,
      message: run.message ? run.message.slice(0, MAX_MESSAGE) : null,
      model_id: run.modelId ?? report?.modelId ?? null,
      leads_with_click_id: report?.coverage?.clicks ?? null,
      leads_with_email: report?.coverage?.emails ?? null,
      leads_with_neither: report?.coverage?.neither ?? null,
    });

    // Losing the record of a good run must not turn it into a bad one, but a
    // job whose history silently stops being written is the exact blindness
    // this table exists to remove - so it is loud in the server log.
    if (error) console.error("recording a sync run failed:", error.message);
  }

  async recentForWorkspace(clientId: string, limit: number): Promise<SyncRun[]> {
    const { data, error } = await this.client
      .from("sync_runs")
      .select(COLUMNS)
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as RunDto[]).map(toRun);
  }
}

// ---------------------------------------------------------------------------
// In-memory, for tests
// ---------------------------------------------------------------------------

export class InMemorySyncRunStore implements SyncRunStore {
  readonly runs: SyncRun[] = [];
  private seq = 0;

  async record(run: RecordRun): Promise<void> {
    const report = run.report;
    this.runs.unshift({
      id: ++this.seq,
      feedId: run.feedId,
      clientId: run.clientId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? run.startedAt,
      status: run.status,
      dealsPulled: report?.dealsPulled ?? 0,
      rowsPublished: report?.rowsAdded ?? 0,
      newConversions: report?.newConversions ?? 0,
      adjustments: report?.adjustments ?? 0,
      recalibrationOnly: report?.recalibrationOnly ?? 0,
      unchanged: report?.unchanged ?? 0,
      skipped: report?.skipped.reduce((sum, s) => sum + s.count, 0) ?? 0,
      message: run.message ? run.message.slice(0, MAX_MESSAGE) : null,
      modelId: run.modelId ?? report?.modelId ?? null,
      coverage: report?.coverage ?? null,
    });
  }

  async recentForWorkspace(clientId: string, limit: number): Promise<SyncRun[]> {
    return this.runs.filter((r) => r.clientId === clientId).slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Reading the history
// ---------------------------------------------------------------------------

/** A run every 24 hours, plus room for a late one before it counts as missed. */
export const EXPECTED_INTERVAL_HOURS = 24;
export const OVERDUE_AFTER_HOURS = 36;

export interface RunHealth {
  state: "never-run" | "healthy" | "overdue" | "failing";
  message: string;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  /** What to do about it, empty when there is nothing to do. */
  action: string | null;
}

/**
 * Reads the run history the way an operator would.
 *
 * The three states that matter are different problems with different fixes:
 * nothing has ever run (it was never set up), runs are happening and failing
 * (the connection or the model), and runs have stopped happening at all (the
 * schedule itself). Only the last one is invisible without this table.
 */
export function runHealth(runs: SyncRun[], now: Date = new Date()): RunHealth {
  const lastRun = runs[0] ?? null;
  const lastSuccess = runs.find((r) => r.status === "ok") ?? null;

  if (!lastRun) {
    return {
      state: "never-run",
      message: "The nightly sync has not run yet.",
      lastRunAt: null,
      lastSuccessAt: null,
      action:
        "If a CRM was connected today, the first run happens overnight. If it was connected days ago, the scheduled job is not running - that one is for the developer.",
    };
  }

  const hoursSince = (now.getTime() - lastRun.startedAt.getTime()) / 3_600_000;

  if (hoursSince > OVERDUE_AFTER_HOURS) {
    const days = Math.floor(hoursSince / 24);
    return {
      state: "overdue",
      message: `The nightly sync has not run for ${days === 0 ? "over a day" : `${days} days`}. New leads are not reaching Google.`,
      lastRunAt: lastRun.startedAt,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      action: "The scheduled job itself has stopped. Escalate to the developer.",
    };
  }

  if (lastRun.status !== "ok") {
    return {
      state: "failing",
      message: lastRun.message ?? "The last sync did not complete.",
      lastRunAt: lastRun.startedAt,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      action: null,
    };
  }

  return {
    state: "healthy",
    message: `Last sync published ${lastRun.rowsPublished.toLocaleString()} ${lastRun.rowsPublished === 1 ? "row" : "rows"}.`,
    lastRunAt: lastRun.startedAt,
    lastSuccessAt: lastRun.startedAt,
    action: null,
  };
}
