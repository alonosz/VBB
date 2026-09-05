"use client";

import { useMemo } from "react";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { resolveHypotheses } from "@/lib/intake/merge";
import {
  discoverSignalColumns,
  signalColumnsFor,
  type DiscoveredSignal,
  type RefusedColumn,
} from "@/lib/mapping/signals";
import type { Hypothesis } from "@/lib/intake/merge";

/**
 * The columns the engine will test, decided in one place.
 *
 * Both the mapping screen and the report used to work this out for
 * themselves from the assistant's proposal alone. Now there are two readers -
 * the assistant, and the file's own shape - and two screens each merging them
 * their own way is how the preview prices a lead on a column the report then
 * ignores.
 */
export interface SignalColumns {
  hypotheses: Hypothesis[];
  /** Every column the engine will test, assistant's first. */
  customSignalKeys: string[];
  /** Every column that could be tested, suggested or not. */
  discovered: DiscoveredSignal[];
  /** Protected characteristics, never tested, with the reason. */
  refused: RefusedColumn[];
  /** True where the column is on, whether by shape, claim, or by hand. */
  isOn: (column: string) => boolean;
  /** Columns the assistant named, which are on regardless of shape. */
  fromClaim: Set<string>;
}

export function useSignalColumns(): SignalColumns {
  const { audience, file, fields, intake, signalOverrides, outcomeOverrides } = useDiagnostic();

  return useMemo(() => {
    const fromIntake =
      intake?.status === "ready"
        ? resolveHypotheses(intake.proposal, fields)
        : { hypotheses: [], customSignalKeys: [] };

    const { discovered, refused } = file
      ? discoverSignalColumns(file.headers, file.rows, fields, audience, outcomeOverrides)
      : { discovered: [], refused: [] };

    const customSignalKeys = signalColumnsFor(
      fromIntake.customSignalKeys,
      discovered,
      signalOverrides,
      refused.map((r) => r.column)
    );
    const on = new Set(customSignalKeys);

    return {
      hypotheses: fromIntake.hypotheses,
      customSignalKeys,
      discovered,
      refused,
      isOn: (column: string) => on.has(column),
      fromClaim: new Set(fromIntake.customSignalKeys),
    };
  }, [audience, file, fields, intake, signalOverrides, outcomeOverrides]);
}
