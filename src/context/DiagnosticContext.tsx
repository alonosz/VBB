"use client";

import type { Audience } from "@/lib/analysis/types";
import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { clearFlow, loadFlow, saveFlow } from "@/lib/state/persist";
import { outcomeKey, type OutcomeOverrides } from "@/lib/mapping/outcomes";
import type { DealOutcome } from "@/lib/analysis/types";
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
  /**
   * Who they sell to. Decides which built-in factors can apply and which
   * questions step one asks; nothing about it reaches a value directly.
   */
  audience: Audience;
  setAudience: (a: Audience) => void;

  /**
   * Columns the advertiser switched on or off by hand, over what discovery
   * proposed. Absent means "whatever the file's shape suggested", which is
   * the case for nearly everybody.
   */
  signalOverrides: Record<string, boolean>;
  setSignalOverride: (column: string, on: boolean) => void;

  /**
   * Which values in the outcome or stage column mean a sale, where the
   * advertiser corrected the built-in reading. Null clears a correction.
   */
  outcomeOverrides: OutcomeOverrides;
  setOutcomeOverride: (value: string, outcome: DealOutcome | null) => void;

  businessContext: string;
  setBusinessContext: (v: string) => void;

  /**
   * Claims the advertiser made on purpose rather than in passing. Held to the
   * same standard as anything in the free text: checked against the data,
   * never fed into the value model.
   */
  statedCycleDays: number | null;
  setStatedCycleDays: (v: number | null) => void;
  statedSizeBands: string[];
  setStatedSizeBands: (v: string[]) => void;

  file: UploadedFile | null;
  setFile: (f: UploadedFile | null) => void;

  fields: DetectedField[];
  /**
   * Accepts an updater, because the assisted intake can land after the user is
   * already editing the mapping - it has to merge into whatever is current
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

  /**
   * False until the saved snapshot has been read. Screens wait for it before
   * deciding a customer has nothing in progress, or a refresh would bounce
   * them back to the upload step a frame before their work reappears.
   */
  restored: boolean;
  /** The file was too large to keep across a refresh; the mapping survived. */
  needsFile: boolean;

  reset: () => void;
}

const DEFAULT_CURRENCY: CurrencyPolicy = {
  reportingCurrency: "USD",
  rates: {},
  excludeUnconvertible: true,
};

const Ctx = createContext<DiagnosticState | null>(null);

/** A store that never changes: this only distinguishes server from client. */
const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function DiagnosticProvider({ children }: { children: ReactNode }) {
  /**
   * Read once, synchronously, before the first client render.
   *
   * Restoring in an effect would paint an empty flow and then replace it,
   * which is both a cascading render and a visible flicker back to the upload
   * step. Guarded on window because session storage does not exist during
   * server rendering - there the flow is simply empty, which is correct.
   */
  const [snapshot] = useState(() => (typeof window === "undefined" ? null : loadFlow()));

  const [audience, setAudience] = useState<Audience>(snapshot?.audience ?? "b2b");
  const [signalOverrides, setSignalOverrides] = useState<Record<string, boolean>>(
    snapshot?.signalOverrides ?? {}
  );
  const setSignalOverride = useCallback((column: string, on: boolean) => {
    setSignalOverrides((current) => ({ ...current, [column]: on }));
  }, []);
  const [outcomeOverrides, setOutcomeOverrides] = useState<OutcomeOverrides>(
    snapshot?.outcomeOverrides ?? {}
  );
  const setOutcomeOverride = useCallback((value: string, outcome: DealOutcome | null) => {
    setOutcomeOverrides((current) => {
      const next = { ...current };
      if (outcome === null) delete next[outcomeKey(value)];
      else next[outcomeKey(value)] = outcome;
      return next;
    });
  }, []);
  const [businessContext, setBusinessContext] = useState(snapshot?.businessContext ?? "");
  const [statedCycleDays, setStatedCycleDays] = useState<number | null>(
    snapshot?.statedCycleDays ?? null
  );
  const [statedSizeBands, setStatedSizeBands] = useState<string[]>(
    snapshot?.statedSizeBands ?? []
  );
  const [file, setFile] = useState<UploadedFile | null>(
    snapshot?.file && snapshot.file.rows.length > 0 ? snapshot.file : null
  );
  const [fields, setFields] = useState<DetectedField[]>(snapshot?.fields ?? []);
  const [issues, setIssues] = useState<FileIssue[]>(snapshot?.issues ?? []);
  const [stageTiming, setStageTiming] = useState<StageTimingColumn[]>(
    snapshot?.stageTiming ?? []
  );
  const [currency, setCurrency] = useState<CurrencyPolicy>(
    snapshot?.currency ?? DEFAULT_CURRENCY
  );
  const [intake, setIntake] = useState<IntakeResult | null>(snapshot?.intake ?? null);

  const [needsFile, setNeedsFile] = useState(
    !!snapshot?.rowsDropped && !!snapshot?.file
  );

  /**
   * False on the server and during hydration, true immediately after.
   *
   * The restored flow only exists in the browser, so a page that rendered it
   * straight away would produce different markup on each side and React would
   * reject the hydration. Screens render a skeleton while this is false, which
   * matches on both sides, and the real content appears on the next pass with
   * the snapshot already in state - so there is no flicker of empty data
   * either.
   */
  const restored = useSyncExternalStore(subscribeNever, onClient, onServer);

  useEffect(() => {
    // An empty flow has no snapshot rather than an empty one. Without this,
    // Start over would clear storage and then immediately write blank state
    // back over it, and the next refresh would restore nothing-in-particular
    // instead of a clean start.
    if (!file && fields.length === 0 && !businessContext) {
      clearFlow();
      return;
    }
    saveFlow({
      audience, businessContext, statedCycleDays, statedSizeBands, signalOverrides, outcomeOverrides,
      file, fields, issues, stageTiming, currency, intake,
    });
  }, [audience, businessContext, statedCycleDays, statedSizeBands, signalOverrides, outcomeOverrides, file, fields, issues, stageTiming, currency, intake]);

  const reset = useCallback(() => {
    clearFlow();
    setNeedsFile(false);
    setAudience("b2b");
    // Start over used to leave these behind, so the next file inherited the
    // last file's switches under column names that happened to match.
    setSignalOverrides({});
    setOutcomeOverrides({});
    setBusinessContext("");
    setStatedCycleDays(null);
    setStatedSizeBands([]);
    setFile(null);
    setFields([]);
    setIssues([]);
    setStageTiming([]);
    setCurrency(DEFAULT_CURRENCY);
    setIntake(null);
  }, []);

  const value = useMemo(
    () => ({
      audience, setAudience,
      signalOverrides, setSignalOverride,
      outcomeOverrides, setOutcomeOverride,
      businessContext, setBusinessContext,
      statedCycleDays, setStatedCycleDays,
      statedSizeBands, setStatedSizeBands,
      file, setFile,
      fields, setFields,
      issues, setIssues,
      stageTiming, setStageTiming,
      currency, setCurrency,
      intake, setIntake,
      restored, needsFile,
      reset,
    }),
    [audience, businessContext, statedCycleDays, statedSizeBands, signalOverrides, setSignalOverride, outcomeOverrides, setOutcomeOverride, file, fields, issues, stageTiming, currency, intake, restored, needsFile, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiagnostic(): DiagnosticState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDiagnostic must be used within DiagnosticProvider");
  return ctx;
}
