"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/context/AppStateContext";
import { StepHeader } from "@/components/StepHeader";
import { FileDropzone } from "@/components/FileDropzone";
import { DataTable } from "@/components/DataTable";
import { CsvParseError, parseCsvFile } from "@/lib/csv";
import type { MatchType } from "@/lib/types";
import { ArrowIcon } from "@/components/ArrowIcon";

function guessMatchColumn(headers: string[]): { column: string; type: MatchType } | null {
  const lower = headers.map((h) => h.toLowerCase());
  const gclidIdx = lower.findIndex((h) => h.includes("gclid") || h.includes("click id"));
  if (gclidIdx !== -1) return { column: headers[gclidIdx], type: "gclid" };
  const emailIdx = lower.findIndex((h) => h.includes("email"));
  if (emailIdx !== -1) return { column: headers[emailIdx], type: "email" };
  return null;
}

export default function UploadPage() {
  const router = useRouter();
  const { csvData, setCsvData, model, matchConfig, setMatchConfig } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    try {
      const data = await parseCsvFile(file);
      setCsvData(data);
      const guess = guessMatchColumn(data.headers);
      setMatchConfig({
        column: guess?.column ?? null,
        type: guess?.type ?? "email",
      });
    } catch (err) {
      setError(
        err instanceof CsvParseError
          ? err.message
          : "Something went wrong reading that file."
      );
    } finally {
      setLoading(false);
    }
  }

  const canContinue = !!csvData;

  const missingMatchCount = useMemo(() => {
    if (!csvData || !matchConfig.column) return 0;
    return csvData.rows.filter((r) => !(r[matchConfig.column!] ?? "").trim()).length;
  }, [csvData, matchConfig.column]);

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <StepHeader current="upload" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Upload sample data</h1>
          <p className="mt-1 text-sm text-[#6b6d85]">
            Upload a CSV of historical conversion records — leads, applications,
            inquiries, orders, whatever your outcomes look like.
            {model && (
              <>
                {" "}
                You&apos;re scoring with the loaded model{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  &ldquo;{model.name}&rdquo;
                </span>
                .
              </>
            )}
          </p>
        </div>

        {!csvData && (
          <FileDropzone
            accept=".csv,text/csv"
            icon="📊"
            title={loading ? "Reading file…" : "Drop your CSV here or click to browse"}
            subtitle="Any vertical works — B2B, real estate, insurance, education, home services, etc."
            onFile={handleFile}
          />
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        {csvData && (
          <div className="animate-block-enter space-y-6">
            <div className="card flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold">{csvData.fileName}</p>
                <p className="text-xs text-[#8688a0]">
                  {csvData.rowCount.toLocaleString()} rows · {csvData.headers.length} columns
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => {
                  setCsvData(null);
                  setError(null);
                }}
              >
                Replace file
              </button>
            </div>

            <div>
              <p className="label mb-2">Preview (first 10 rows)</p>
              <DataTable
                headers={csvData.headers}
                rows={csvData.rows}
                maxRows={10}
                highlightColumn={matchConfig.column}
              />
            </div>

            <div className="card p-5">
              <p className="text-sm font-semibold">Match field for ad-platform export</p>
              <p className="mt-1 text-xs text-[#8688a0]">
                Which column identifies each record for offline conversion import
                (a Google Click ID, or the email address used at conversion)?
                This is optional now, but rows missing it will be excluded from
                the final export.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <select
                  className="input max-w-[240px]"
                  value={matchConfig.column ?? ""}
                  onChange={(e) =>
                    setMatchConfig({
                      ...matchConfig,
                      column: e.target.value || null,
                    })
                  }
                >
                  <option value="">No match field (skip for now)</option>
                  {csvData.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <div className="flex overflow-hidden rounded-lg border border-[var(--border)]">
                  {(["email", "gclid"] as MatchType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setMatchConfig({ ...matchConfig, type: t })}
                      className={
                        "px-3 py-1.5 text-xs font-semibold transition-colors " +
                        (matchConfig.type === t
                          ? "bg-[var(--primary)] text-white"
                          : "bg-white text-[#6b6d85] hover:bg-[#f3f3f8]")
                      }
                    >
                      {t === "email" ? "Email" : "Google Click ID"}
                    </button>
                  ))}
                </div>
                {matchConfig.column && missingMatchCount > 0 && (
                  <span className="text-xs font-medium text-[var(--warn)]">
                    {missingMatchCount.toLocaleString()} row(s) are missing this field
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!canContinue}
                onClick={() => router.push("/build")}
                className="btn btn-primary"
              >
                Continue to model builder <ArrowIcon />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
