import { profileColumns, type ColumnProfile } from "./profile";
import {
  EMPTY_PROPOSAL,
  sanitizeProposal,
  type IntakeOutcome,
} from "./proposal";

/**
 * Browser side of the assisted intake.
 *
 * Builds the column profiles here so it is visible in the client bundle
 * exactly what leaves the machine, calls the route, and returns an outcome
 * that always lets the flow continue.
 */

const CLIENT_TIMEOUT_MS = 12_000;

export interface IntakeRequest {
  businessContext: string;
  headers: string[];
  rows: Record<string, string>[];
}

export interface IntakeResult extends IntakeOutcome {
  /** Exactly what was sent, so the mapping screen can show it. */
  sent: ColumnProfile[];
}

/**
 * The key the workspace page stored, if this browser has one.
 *
 * The assisted intake spends money on someone's behalf, so it belongs to a
 * customer. Without a key the endpoint refuses and the flow falls back to
 * header matching — the same path it already takes when no API key is
 * configured, so nobody is blocked by this.
 */
function storedWorkspaceKey(): string | null {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem("vbb.workspaceKey.v1");
  } catch {
    return null;
  }
}

export async function requestIntakeProposal(req: IntakeRequest): Promise<IntakeResult> {
  const sent = profileColumns(req.headers, req.rows);

  if (!req.businessContext.trim()) {
    return {
      status: "skipped",
      proposal: EMPTY_PROPOSAL,
      reason: "You skipped the description, so we matched columns by name only.",
      sent,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessContext: req.businessContext,
        columns: sent,
        workspaceKey: storedWorkspaceKey(),
      }),
      signal: controller.signal,
    });

    const data: unknown = await res.json().catch(() => null);
    const d = (data ?? {}) as Record<string, unknown>;

    if (!res.ok || d.ok !== true) {
      return {
        status: "unavailable",
        proposal: EMPTY_PROPOSAL,
        reason:
          typeof d.reason === "string"
            ? d.reason
            : "The mapping suggestion could not run — we used our own column matching instead.",
        sent,
      };
    }

    // Sanitized on the server too. Doing it again here costs nothing and means
    // no un-checked model output can reach the mapping screen.
    return {
      status: "ready",
      proposal: sanitizeProposal(d.proposal, req.headers),
      reason: null,
      sent,
    };
  } catch {
    return {
      status: "unavailable",
      proposal: EMPTY_PROPOSAL,
      reason: "The mapping suggestion timed out — we used our own column matching instead.",
      sent,
    };
  } finally {
    clearTimeout(timer);
  }
}
