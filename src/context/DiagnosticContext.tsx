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
import { recallModel } from "@/lib/model/storage";
import { clearFlow, loadFlow, saveFlow } from "@/lib/state/persist";
import { outcomeKey, type OutcomeOverrides } from "@/lib/mapping/outcomes";
import type { DealOutcome } from "@/lib/analysis/types";
import type { DetectedField, FileIssue, StageTimingColumn } from "@/lib/mapping/detect";
import type { CurrencyPolicy } from "@/lib/mapping/toDeals";
import type { IntakeResult } from "@/lib/intake/client";
import { proposedOutcomes as proposedOutcomes_ } from "@/lib/intake/proposal";
import { effectiveOutcomeOverrides as effectiveOutcomeOverrides_ } from "@/lib/mapping/outcomes";
import { applySortedColumn, removeSortedColumn as removeSortedColumn_, type SortedColumn } from "@/lib/intake/sort";

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
  /**
   * The assistant's reading of the deciding column's values, keyed like the
   * overrides. Shown on the mapping screen as its own voice.
   */
  proposedOutcomes: OutcomeOverrides;
  /**
   * The reading every screen prices on: the advertiser's word, then the
   * built-in list, then the assistant where the list knows nothing.
   */
  effectiveOutcomeOverrides: OutcomeOverrides;

  /**
   * Saved model or fresh fit, as chosen on the report. Null until chosen.
   * The send step reads it, so what was shown is what is sent.
   */
  modelSource: "fresh" | "saved" | null;
  setModelSource: (s: "fresh" | "saved" | null) => void;

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
  /**
   * Free-text columns the advertiser chose to have sorted into buckets, and
   * the column each became. The labels live in the file's rows; this is the
   * record of where they came from, so the screen can say so and undo it.
   */
  sortedColumns: SortedColumn[];
  addSortedColumn: (sorted: SortedColumn, byText: Record<string, string>) => void;
  removeSortedColumn: (header: string) => void;

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

  /**
   * A fresh tab with a saved model in this browser is a returning customer
   * with the next export, not a first visit. The model already knows who
   * they sell to, so the upload step can be entered directly and step one
   * is not asked again. Pricing lands on the saved model for the same
   * reason: that is what a re-upload is for.
   */
  const [saved] = useState(() => (snapshot || typeof window === "undefined" ? null : recallModel()));

  const [audience, setAudience] = useState<Audience>(snapshot?.audience ?? saved?.audience ?? "b2b");
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
  const [intake, setIntake] = useState<IntakeResult | null>(snapshot?.intake ?? null);
  const [modelSource, setModelSource] = useState<"fresh" | "saved" | null>(
    snapshot?.modelSource ?? (saved ? "saved" : null)
  );
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
  const [sortedColumns, setSortedColumns] = useState<SortedColumn[]>(snapshot?.sortedColumns ?? []);
  // A new file must not inherit the last file's sorted columns, or the
  // record would name a column the rows no longer carry.
  const replaceFile = useCallback((f: UploadedFile | null) => {
    setFile(f);
    setSortedColumns([]);
  }, []);
  const addSortedColumn = useCallback((sorted: SortedColumn, byText: Record<string, string>) => {
    setFile((current) => (current ? { ...current, ...applySortedColumn(current, sorted.source, byText) } : current));
    setSortedColumns((current) => [...current.filter((c) => c.header !== sorted.header), sorted]);
    setSignalOverrides((current) => ({ ...current, [sorted.header]: true }));
  }, []);
  const removeSortedColumn = useCallback((header: string) => {
    setFile((current) => (current ? { ...current, ...removeSortedColumn_(current, header) } : current));
    setSortedColumns((current) => current.filter((c) => c.header !== header));
    setSignalOverrides((current) => {
      const next = { ...current };
      delete next[header];
      return next;
    });
  }, []);
  const proposedOutcomes = useMemo(() => {
    const col = (key: string) => fields.find((f) => f.key === key)?.column ?? null;
    return proposedOutcomes_(intake?.status === "ready" ? intake.proposal : null, col("outcome") ?? col("stage"));
  }, [intake, fields]);
  const effectiveOutcomeOverrides = useMemo(
    () => effectiveOutcomeOverrides_(outcomeOverrides, proposedOutcomes),
    [outcomeOverrides, proposedOutcomes]
  );
  const [issues, setIssues] = useState<FileIssue[]>(snapshot?.issues ?? []);
  const [stageTiming, setStageTiming] = useState<StageTimingColumn[]>(
    snapshot?.stageTiming ?? []
  );
  const [currency, setCurrency] = useState<CurrencyPolicy>(
    snapshot?.currency ?? DEFAULT_CURRENCY
  );

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
      audience, businessContext, statedCycleDays, statedSizeBands, signalOverrides, outcomeOverrides, modelSource,
      file, sortedColumns, fields, issues, stageTiming, currency, intake,
    });
  }, [audience, businessContext, statedCycleDays, statedSizeBands, signalOverrides, outcomeOverrides, modelSource, file, sortedColumns, fields, issues, stageTiming, currency, intake]);

  const reset = useCallback(() => {
    clearFlow();
    setNeedsFile(false);
    setAudience("b2b");
    // Start over used to leave these behind, so the next file inherited the
    // last file's switches under column names that happened to match.
    setSignalOverrides({});
    setOutcomeOverrides({});
    setModelSource(null);
    setBusinessContext("");
    setStatedCycleDays(null);
    setStatedSizeBands([]);
    setFile(null);
    setSortedColumns([]);
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
      proposedOutcomes, effectiveOutcomeOverrides,
      modelSource, setModelSource,
      businessContext, setBusinessContext,
      statedCycleDays, setStatedCycleDays,
      statedSizeBands, setStatedSizeBands,
      file, setFile: replaceFile,
      sortedColumns, addSortedColumn, removeSortedColumn,
      fields, setFields,
      issues, setIssues,
      stageTiming, setStageTiming,
      currency, setCurrency,
      intake, setIntake,
      restored, needsFile,
      reset,
    }),
    [audience, businessContext, statedCycleDays, statedSizeBands, signalOverrides, setSignalOverride, outcomeOverrides, setOutcomeOverride, proposedOutcomes, effectiveOutcomeOverrides, modelSource, file, replaceFile, sortedColumns, addSortedColumn, removeSortedColumn, fields, issues, stageTiming, currency, intake, restored, needsFile, reset]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiagnostic(): DiagnosticState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDiagnostic must be used within DiagnosticProvider");
  return ctx;
}
