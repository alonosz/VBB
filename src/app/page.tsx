"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/context/AppStateContext";
import { parseModelFile, ModelParseError } from "@/lib/modelIO";

export default function LandingPage() {
  const router = useRouter();
  const { setModel } = useAppState();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleModelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const model = await parseModelFile(file);
      setModel(model);
      router.push("/upload");
    } catch (err) {
      setError(
        err instanceof ModelParseError
          ? err.message
          : "Something went wrong reading that file."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-1 text-xs font-medium text-[#6b6d85]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          No code. No data science team. No live integrations required.
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Build a value-based bidding model from your own conversion data
        </h1>
        <p className="mt-4 max-w-2xl text-base text-[#6b6d85] sm:text-lg">
          Turn historical leads and outcomes into a reusable scoring model —
          visually, in minutes. Export ad-platform-ready conversion values
          whenever you have new data, without touching code.
        </p>

        <div className="mt-12 grid w-full max-w-3xl gap-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => router.push("/upload")}
            className="card group flex flex-col items-start gap-3 p-6 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-[var(--primary)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-lg">
              🧩
            </span>
            <span className="text-base font-semibold">
              Build a lead scoring model
            </span>
            <span className="text-sm text-[#6b6d85]">
              Start fresh: upload sample data and stack scoring rules
              visually to build a new model from scratch.
            </span>
            <span className="mt-auto text-sm font-semibold text-[var(--primary)] opacity-0 transition-opacity group-hover:opacity-100">
              Start building →
            </span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="card group flex flex-col items-start gap-3 p-6 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-[var(--primary)] disabled:opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-lg">
              📂
            </span>
            <span className="text-base font-semibold">
              Load a saved model
            </span>
            <span className="text-sm text-[#6b6d85]">
              Re-use a model you exported earlier. Upload its .json file,
              then score a fresh batch of data with it.
            </span>
            <span className="mt-auto text-sm font-semibold text-[var(--primary)] opacity-0 transition-opacity group-hover:opacity-100">
              {loading ? "Loading…" : "Choose file →"}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleModelFile}
          />
        </div>

        {error && (
          <p className="mt-4 max-w-lg rounded-lg border border-[var(--danger)]/30 bg-red-50 px-4 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <p className="mt-10 text-xs text-[#9698b3]">
          Works for any vertical — B2B, real estate, insurance, education,
          home services, and more.
        </p>
      </div>
    </main>
  );
}
