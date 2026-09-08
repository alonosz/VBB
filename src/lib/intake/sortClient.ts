import type { Audience } from "@/lib/analysis/types";
import { readWorkspaceKey, rememberWorkspaceKey } from "@/lib/workspace/clientKey";
import { SORT_BATCH, sanitizeSortAnswer, textsOf } from "./sort";

/**
 * Browser side of sorting a column: the distinct scrubbed messages go up in
 * batches, the first batch fixes the buckets, and what comes back is a
 * label per message. Sequential rather than parallel, so a large file does
 * not trip the rate limit and fail halfway.
 */

export interface SortProgress {
  sent: number;
  total: number;
}

export interface SortResult {
  ok: boolean;
  labels: string[];
  /** Scrubbed text -> label. */
  byText: Record<string, string>;
  texts: number;
  reason: string | null;
}

export async function sortColumn(opts: {
  rows: Record<string, string>[];
  column: string;
  businessContext: string;
  audience: Audience;
  onProgress?: (p: SortProgress) => void;
}): Promise<SortResult> {
  const texts = textsOf(opts.rows, opts.column);
  const byText: Record<string, string> = {};
  let labels: string[] | null = null;

  if (texts.length === 0) {
    return { ok: false, labels: [], byText, texts: 0, reason: "Nobody wrote anything in that column." };
  }

  for (let start = 0; start < texts.length; start += SORT_BATCH) {
    const batch = texts.slice(start, start + SORT_BATCH);
    let data: Record<string, unknown>;
    try {
      const res = await fetch("/api/intake/sort", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceKey: readWorkspaceKey(),
          column: opts.column,
          texts: batch,
          labels,
          businessContext: opts.businessContext,
          audience: opts.audience,
        }),
      });
      data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    } catch {
      return { ok: false, labels: labels ?? [], byText, texts: texts.length, reason: "We couldn't reach the server. Try again." };
    }
    if (typeof data.workspaceKey === "string" && data.workspaceKey.trim()) {
      rememberWorkspaceKey(data.workspaceKey.trim());
    }
    if (data.ok !== true) {
      return {
        ok: false,
        labels: labels ?? [],
        byText,
        texts: texts.length,
        reason: typeof data.reason === "string" ? data.reason : "The sorting could not run.",
      };
    }
    // Checked here as well as on the server: nothing unchecked reaches the file.
    const answer = sanitizeSortAnswer(data, batch.length, labels);
    labels = answer.labels;
    answer.assignments.forEach((label, i) => {
      if (label) byText[batch[i]] = label;
    });
    opts.onProgress?.({ sent: Math.min(start + batch.length, texts.length), total: texts.length });
  }

  return { ok: true, labels: labels ?? [], byText, texts: texts.length, reason: null };
}
