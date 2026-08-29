"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { detectColumns, detectStageTimingColumns, findFileIssues } from "@/lib/mapping/detect";
import { requestIntakeProposal } from "@/lib/intake/client";
import { applyProposal } from "@/lib/intake/merge";
import { describeWhatIsSent } from "@/lib/intake/profile";

/**
 * Everything that happens between "we have rows" and "show them the mapping".
 *
 * Shared by the upload screen and the sample-dataset shortcut so both take
 * exactly the same path - a demo that runs different code is a demo of
 * something else.
 */

/**
 * How long the flow will wait for the assisted read before moving on.
 *
 * Short on purpose. When the call is quick the mapping screen opens already
 * filled in; when it is not, the user is not left watching a spinner for a
 * suggestion they did not ask for. Either way the request keeps going and
 * merges into the mapping the moment it lands.
 */
export const INTAKE_GRACE_MS = 3_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface IngestInput {
  name: string;
  sizeBytes: number;
  headers: string[];
  rows: Record<string, string>[];
  /**
   * Overrides the description held in context. The sample-dataset shortcut
   * fills the description and starts in the same click, and a state update
   * from that click is not visible to this callback yet.
   */
  businessContext?: string;
}

export function useIngest(onLog?: (line: string) => void) {
  const router = useRouter();
  const { businessContext, setFile, setFields, setIssues, setStageTiming, setIntake } =
    useDiagnostic();

  return useCallback(
    async ({ name, sizeBytes, headers, rows, businessContext: override }: IngestInput) => {
      const log = (line: string) => onLog?.(line);
      const description = (override ?? businessContext).trim();

      log(`Read ${rows.length.toLocaleString()} rows across ${headers.length} columns`);

      const { fields } = detectColumns(headers, rows);
      log("Sampled every column to detect types");
      log(`Matched ${fields.filter((f) => f.column !== null).length} fields`);

      const stageTiming = detectStageTimingColumns(headers, rows);
      if (stageTiming.length > 0) {
        log(`Found stage timing on ${stageTiming.length} column(s)`);
      }

      const issues = findFileIssues(rows, fields);
      log(`Flagged ${issues.length} thing${issues.length === 1 ? "" : "s"} for review`);

      setFile({ name, sizeBytes, headers, rows });
      setFields(fields);
      setIssues(issues);
      setStageTiming(stageTiming);

      if (description) {
        log("Reading your description against these columns…");

        const pending = requestIntakeProposal({ businessContext: description, headers, rows })
          .then((intake) => {
            setIntake(intake);
            if (intake.status === "ready") {
              // Merges into whatever the mapping is now, so edits made while
              // this was in flight survive.
              setFields((current) => applyProposal(current, intake.proposal).fields);
              const sent = describeWhatIsSent(intake.sent);
              log(`Described ${sent.columns} columns - values withheld on ${sent.withheld}`);
            } else if (intake.reason) {
              log(intake.reason);
            }
          })
          .catch(() => {
            // The heuristics already stand on their own; nothing to recover.
          });

        await Promise.race([pending, delay(INTAKE_GRACE_MS)]);
      }

      router.push("/diagnostic/mapping");
    },
    [businessContext, onLog, router, setFields, setFile, setIntake, setIssues, setStageTiming]
  );
}
