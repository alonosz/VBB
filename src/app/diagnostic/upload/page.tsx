"use client";

import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { generateDemoDeals, demoDealsToCsvRows } from "@/lib/fixtures/demoDataset";
import { useIngest } from "@/lib/diagnostic/useIngest";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 100_000;

export default function UploadPage() {
  const router = useRouter();
  const { businessContext, needsFile } = useDiagnostic();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // The assisted read only happens when there is a description to read.
  const assisted = businessContext.trim().length > 0;

  const appendLog = useCallback((line: string) => setLog((l) => [...l, line]), []);
  const ingest = useIngest(appendLog);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);

      if (file.size > MAX_BYTES) {
        setError(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please upload a CSV under 25 MB, or export a shorter date range.`
        );
        return;
      }

      setParsing(true);
      setLog([]);

      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
        complete: (results) => {
          const headers = (results.meta.fields ?? []).filter(Boolean);

          if (headers.length === 0) {
            setParsing(false);
            setError(
              "No columns found. Make sure the first row of the file contains column headers."
            );
            return;
          }

          const rows = results.data.filter((r) =>
            Object.values(r).some((v) => (v ?? "").toString().trim() !== "")
          );

          if (rows.length === 0) {
            setParsing(false);
            setError("No data rows found below the header row.");
            return;
          }
          if (rows.length > MAX_ROWS) {
            setParsing(false);
            setError(
              `That file has ${rows.length.toLocaleString()} rows, over the ${MAX_ROWS.toLocaleString()} limit. Export a shorter date range and try again.`
            );
            return;
          }

          setLog([]);
          void ingest({ name: file.name, sizeBytes: file.size, headers, rows });
        },
        error: (err) => {
          setParsing(false);
          setError(`Could not read that CSV: ${err.message}`);
        },
      });
    },
    [ingest]
  );

  function loadDemo() {
    setError(null);
    setParsing(true);
    setLog([]);
    const rows = demoDealsToCsvRows(generateDemoDeals());
    setTimeout(
      () =>
        void ingest({
          name: "demo_deals_export.csv",
          sizeBytes: 248_000,
          headers: Object.keys(rows[0]),
          rows,
        }),
      350
    );
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="upload" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <p className="label mb-2">Step 2 of 5</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {parsing ? "Reading your file…" : "Upload your CRM deal export"}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-[var(--muted)]">
          {parsing
            ? "Parsing rows, sampling values, and matching columns against the fields the analysis needs."
            : "A CSV of deals or opportunities — whatever your CRM exports. We'll work out which columns are which and tell you straight away if anything will cause trouble."}
        </p>

        {/* Reached by refreshing with an export too large to keep in the tab.
            The mapping survived; only the rows did not. */}
        {needsFile && (
          <p className="mt-4 max-w-[70ch] rounded-xl border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-4 py-3 text-[13.5px]">
            <span className="font-semibold">Your column mapping is still here.</span>{" "}
            Your export was too large to keep in the browser across a refresh, so
            select the same file again — your choices will be waiting.
          </p>
        )}

        {!parsing && (
          <>
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
              className={
                "mt-7 cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-all " +
                (dragging
                  ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                  : "border-[var(--border)] bg-white hover:-translate-y-0.5 hover:border-[var(--primary)]/60 hover:bg-[var(--primary-soft)]/40")
              }
            >
              <span className="mx-auto mb-4 flex h-13 w-13 items-center justify-center rounded-2xl bg-[var(--primary-soft)] p-3">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3.5 15v2.5A2.5 2.5 0 0 0 6 20h12a2.5 2.5 0 0 0 2.5-2.5V15" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <p className="text-[15px] font-semibold">Drop your CSV here, or click to browse</p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                HubSpot, Salesforce, Pipedrive, Close, or a plain spreadsheet export
              </p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-3.5 py-1.5 text-xs text-[var(--muted)]">
                {assisted
                  ? "Parsed in your browser — your rows stay on your machine"
                  : "Parsed in your browser — the file never leaves your machine"}
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleFile(f);
              }}
            />

            {assisted && (
              <details className="mt-4 rounded-xl border border-[var(--border)] bg-white px-4 py-3">
                <summary className="cursor-pointer text-[13px] font-semibold">
                  What we send to match your description to your columns
                </summary>
                <div className="mt-2.5 space-y-1.5 text-[13px] text-[var(--muted)]">
                  <p className="max-w-[70ch]">
                    To line up what you wrote in step 1 with what is in this file, we
                    send a description of each column — its name, whether it holds
                    dates, numbers or categories, how full it is, and how many
                    distinct values it has.
                  </p>
                  <p className="max-w-[70ch]">
                    For short category columns like Stage or Industry we include a few
                    of the labels. We do not send email addresses, names, phone
                    numbers, click IDs, deal amounts, free-text notes, or any row from
                    your file.
                  </p>
                  <p className="max-w-[70ch]">
                    It proposes which column is which and writes down the claims you
                    made. Every figure in your report is computed here, from your own
                    rows.{" "}
                    <button
                      type="button"
                      onClick={() => router.push("/diagnostic")}
                      className="font-semibold text-[var(--primary)] underline underline-offset-[3px]"
                    >
                      Clear your description
                    </button>{" "}
                    to skip this entirely.
                  </p>
                </div>
              </details>
            )}

            {error && (
              <p className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-[var(--muted)]">
                No export handy? Try it on a synthetic dataset first.
              </p>
              <button type="button" onClick={loadDemo} className="btn btn-secondary text-[13px]">
                Use demo data
              </button>
            </div>
          </>
        )}

        {parsing && (
          <div className="mt-7">
            <div className="card space-y-3.5 p-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="grid grid-cols-[150px_1fr_92px] items-center gap-3.5">
                  <div className="skeleton h-3" />
                  <div className="skeleton h-8" />
                  <div className="skeleton h-5" />
                </div>
              ))}
            </div>
            <div className="card mt-4 px-5 py-3.5">
              {log.map((line, i) => (
                <p
                  key={i}
                  className="animate-block-enter flex items-center gap-2.5 py-1 text-[13px] text-[var(--muted)]"
                >
                  <span className="font-bold text-[var(--accent)]">✓</span> {line}
                </p>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
