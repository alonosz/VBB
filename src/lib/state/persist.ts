import type { Audience } from "@/lib/analysis/types";
import type { DetectedField, FileIssue, StageTimingColumn } from "@/lib/mapping/detect";
import type { CurrencyPolicy } from "@/lib/mapping/toDeals";
import type { IntakeResult } from "@/lib/intake/client";
import type { OutcomeOverrides } from "@/lib/mapping/outcomes";

/**
 * Keeping the diagnostic flow across a refresh.
 *
 * Losing ten minutes of mapping to a stray reload is the kind of thing that
 * ends a trial, and until now every step lived in useState and nowhere else.
 *
 * Session storage rather than local storage, deliberately. The uploaded file
 * is the customer's raw CRM export - names, addresses, deal amounts - and it
 * has no business outliving the tab it was opened in. A shared machine, a
 * borrowed laptop, a screen share the next morning: none of those should show
 * the last customer's pipeline. Coming back tomorrow is what the workspace
 * page is for, and that holds no raw rows at all.
 *
 * The rows are also the only part large enough to hit a quota. When they do
 * not fit, the mapping is saved without them: the file is on the customer's
 * disk and re-selecting it takes seconds, while the mapping is the work.
 */

const KEY = "vbb.diagnostic.v1";

/** Session storage is a few megabytes; a large export is not. */
const MAX_ROWS_BYTES = 3_000_000;

export interface PersistedFile {
  name: string;
  sizeBytes: number;
  headers: string[];
  rows: Record<string, string>[];
}

export interface PersistedFlow {
  version: 1;
  savedAt: string;
  audience: Audience;
  signalOverrides: Record<string, boolean>;
  /** Which values mean a sale, where the advertiser corrected our reading. */
  outcomeOverrides: OutcomeOverrides;
  businessContext: string;
  statedCycleDays: number | null;
  statedSizeBands: string[];
  file: PersistedFile | null;
  /**
   * True when the file was too large to keep. The mapping below is still
   * valid; the customer just has to re-select the file.
   */
  rowsDropped: boolean;
  fields: DetectedField[];
  issues: FileIssue[];
  stageTiming: StageTimingColumn[];
  currency: CurrencyPolicy;
  intake: IntakeResult | null;
}

export type FlowSnapshot = Omit<PersistedFlow, "version" | "savedAt" | "rowsDropped">;

function storage(): Storage | null {
  try {
    // Absent during server rendering, and throws outright in some privacy
    // modes rather than merely returning null.
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveFlow(snapshot: FlowSnapshot): void {
  const store = storage();
  if (!store) return;

  const write = (payload: PersistedFlow): boolean => {
    try {
      store.setItem(KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  const base: PersistedFlow = {
    version: 1,
    savedAt: new Date().toISOString(),
    rowsDropped: false,
    ...snapshot,
  };

  const rowsBytes = snapshot.file ? JSON.stringify(snapshot.file.rows).length : 0;
  if (rowsBytes <= MAX_ROWS_BYTES && write(base)) return;

  // Too large, or the quota was already full. Keep the work, drop the data.
  write({
    ...base,
    rowsDropped: true,
    file: snapshot.file ? { ...snapshot.file, rows: [] } : null,
  });
}

/**
 * Restores a snapshot, or null when there is nothing usable.
 *
 * Anything malformed is discarded rather than repaired. A half-restored
 * mapping would be worse than an empty one: the customer would not know which
 * of their choices survived.
 */
export function loadFlow(): PersistedFlow | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedFlow>;
    if (parsed.version !== 1) {
      clearFlow();
      return null;
    }
    return {
      version: 1,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
      // A flow saved before the flag existed was a business flow.
      audience: parsed.audience === "b2c" ? "b2c" : "b2b",
      signalOverrides:
        parsed.signalOverrides && typeof parsed.signalOverrides === "object"
          ? Object.fromEntries(
              Object.entries(parsed.signalOverrides).filter(
                ([, v]) => typeof v === "boolean"
              )
            )
          : {},
      outcomeOverrides:
        parsed.outcomeOverrides && typeof parsed.outcomeOverrides === "object"
          ? Object.fromEntries(
              Object.entries(parsed.outcomeOverrides).filter(
                ([, v]) => v === "won" || v === "lost" || v === "open"
              )
            )
          : {},
      businessContext: typeof parsed.businessContext === "string" ? parsed.businessContext : "",
      statedCycleDays:
        typeof parsed.statedCycleDays === "number" ? parsed.statedCycleDays : null,
      statedSizeBands: Array.isArray(parsed.statedSizeBands)
        ? parsed.statedSizeBands.filter((b): b is string => typeof b === "string")
        : [],
      file: parsed.file && typeof parsed.file.name === "string" ? parsed.file : null,
      rowsDropped: parsed.rowsDropped === true,
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      stageTiming: Array.isArray(parsed.stageTiming) ? parsed.stageTiming : [],
      currency:
        parsed.currency && typeof parsed.currency === "object"
          ? (parsed.currency as CurrencyPolicy)
          : { reportingCurrency: "USD", rates: {}, excludeUnconvertible: true },
      intake: (parsed.intake as IntakeResult | null) ?? null,
    };
  } catch {
    clearFlow();
    return null;
  }
}

/** Start over has to actually remove the data, not just blank the screen. */
export function clearFlow(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to do; the tab closing clears it regardless.
  }
}

/** Whether a restored file still has its rows, or needs re-selecting. */
export function needsReupload(flow: PersistedFlow | null): boolean {
  return !!flow && !!flow.file && flow.file.rows.length === 0;
}
