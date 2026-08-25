"use client";

import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DetectedField, FileIssue, StageTimingColumn } from "@/lib/mapping/detect";
import type { CurrencyPolicy } from "@/lib/mapping/toDeals";
import type { IntakeResult } from "@/lib/intake/client";

export interface UploadedFile {
  name: string;
  sizeBytes: number;
  headers: string[];
  rows: Record<string, string>[];
}

interface DiagnosticState {
  businessContext: string;
  setBusinessContext: (v: string) => void;

  file: UploadedFile | null;
  setFile: (f: UploadedFile | null) => void;

  fields: DetectedField[];
  /**
   * Accepts an updater, because the assisted intake can land after the user is
   * already editing the mapping — it has to merge into whatever is current
   * rather than overwrite a snapshot taken before they touched it.
   */
  setFields: Dispatch<SetStateAction<DetectedField[]>>;

  issues: FileIssue[];
  setIssues: (i: FileIssue[]) => void;

  stageTiming: StageTimingColumn[];
  setStageTiming: (s: StageTimingColumn[]) => void;

  currency: CurrencyPolicy;
  setCurrency: (c: CurrencyPolicy) => void;

  /** What the assisted intake proposed, and whether it ran at all. */
  intake: IntakeResult | null;
  setIntake: (i: IntakeResult | null) => void;

  reset: () => void;
}

const DEFAULT_CURRENCY: CurrencyPolicy = {
  reportingCurrency: "USD",
  rates: {},
  excludeUnconvertible: true,
};

const Ctx = createContext<DiagnosticState | null>(null);

export function DiagnosticProvider({ children }: { children: ReactNode }) {
  const [businessContext, setBusinessContext] = useState("");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [fields, setFields] = useState<DetectedField[]>([]);
  const [issues, setIssues] = useState<FileIssue[]>([]);
  const [stageTiming, setStageTiming] = useState<StageTimingColumn[]>([]);
  const [currency, setCurrency] = useState<CurrencyPolicy>(DEFAULT_CURRENCY);
  const [intake, setIntake] = useState<IntakeResult | null>(null);

  const reset = useCallback(() => {
    setBusinessContext("");
    setFile(null);
    setFields([]);
    setIssues([]);
    setStageTiming([]);
    setCurrency(DEFAULT_CURRENCY);
    setIntake(null);
  }, []);

  const value = useMemo(
    () => ({
      businessContext, setBusinessContext,
      file, setFile,
      fields, setFields,
      issues, setIssues,
      stageTiming, setStageTiming,
      currency, setCurrency,
      intake, setIntake,
      reset,
    }),
    [businessContext, file, fields, issues, stageTiming, currency, intake, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiagnostic(): DiagnosticState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDiagnostic must be used within DiagnosticProvider");
  return ctx;
}
