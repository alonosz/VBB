"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DetectedField, FileIssue } from "@/lib/mapping/detect";
import type { CurrencyPolicy } from "@/lib/mapping/toDeals";

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
  setFields: (f: DetectedField[]) => void;

  issues: FileIssue[];
  setIssues: (i: FileIssue[]) => void;

  currency: CurrencyPolicy;
  setCurrency: (c: CurrencyPolicy) => void;

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
  const [currency, setCurrency] = useState<CurrencyPolicy>(DEFAULT_CURRENCY);

  const reset = useCallback(() => {
    setBusinessContext("");
    setFile(null);
    setFields([]);
    setIssues([]);
    setCurrency(DEFAULT_CURRENCY);
  }, []);

  const value = useMemo(
    () => ({
      businessContext, setBusinessContext,
      file, setFile,
      fields, setFields,
      issues, setIssues,
      currency, setCurrency,
      reset,
    }),
    [businessContext, file, fields, issues, currency, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiagnostic(): DiagnosticState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDiagnostic must be used within DiagnosticProvider");
  return ctx;
}
