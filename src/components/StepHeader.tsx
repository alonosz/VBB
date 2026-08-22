"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppState } from "@/context/AppStateContext";

const STEPS = [
  { key: "upload", label: "Upload Data" },
  { key: "build", label: "Build Model" },
  { key: "summary", label: "Summary" },
  { key: "results", label: "Results" },
  { key: "export", label: "Export" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

export function StepHeader({ current }: { current: StepKey }) {
  const router = useRouter();
  const { reset } = useAppState();
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="gradient-navy flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold text-white">
            V
          </span>
          <span className="text-sm font-semibold tracking-tight">
            ValueBasedBidding
          </span>
        </Link>

        <ol className="hidden md:flex items-center gap-1 text-xs font-medium text-[#8688a0]">
          {STEPS.map((step, i) => {
            const state =
              i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
            return (
              <li key={step.key} className="flex items-center gap-1">
                <span
                  className={
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors " +
                    (state === "active"
                      ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                      : state === "done"
                      ? "text-[var(--foreground)]"
                      : "text-[#b3b4c6]")
                  }
                >
                  <span
                    className={
                      "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold " +
                      (state === "active"
                        ? "bg-[var(--primary)] text-white"
                        : state === "done"
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[#e6e7f2] text-[#9698b3]")
                    }
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  {step.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="mx-0.5 h-px w-4 bg-[var(--border)]" />
                )}
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          onClick={() => {
            reset();
            router.push("/");
          }}
          className="btn btn-ghost shrink-0 text-xs"
        >
          Start over
        </button>
      </div>
    </header>
  );
}
