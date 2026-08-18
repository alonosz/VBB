"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CsvData, ExportConfig, MatchConfig, ModelConfig } from "@/lib/types";

interface AppState {
  csvData: CsvData | null;
  setCsvData: (data: CsvData | null) => void;
  model: ModelConfig | null;
  setModel: (model: ModelConfig | null) => void;
  matchConfig: MatchConfig;
  setMatchConfig: (config: MatchConfig) => void;
  exportConfig: ExportConfig;
  setExportConfig: (config: ExportConfig) => void;
  reset: () => void;
}

const defaultMatchConfig: MatchConfig = { column: null, type: "email" };
const defaultExportConfig: ExportConfig = {
  conversionName: "Lead Score Conversion",
  conversionTimeColumn: null,
  currencyCode: "USD",
  maxConversionValue: 100,
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [csvData, setCsvData] = useState<CsvData | null>(null);
  const [model, setModel] = useState<ModelConfig | null>(null);
  const [matchConfig, setMatchConfig] = useState<MatchConfig>(defaultMatchConfig);
  const [exportConfig, setExportConfig] = useState<ExportConfig>(defaultExportConfig);

  const reset = useCallback(() => {
    setCsvData(null);
    setModel(null);
    setMatchConfig(defaultMatchConfig);
    setExportConfig(defaultExportConfig);
  }, []);

  const value = useMemo(
    () => ({
      csvData,
      setCsvData,
      model,
      setModel,
      matchConfig,
      setMatchConfig,
      exportConfig,
      setExportConfig,
      reset,
    }),
    [csvData, model, matchConfig, exportConfig, reset]
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
