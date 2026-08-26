"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { LogoMark } from "@/components/brand/Logo";

/**
 * Short commit SHA of the running build. Vercel injects the full SHA at build
 * time; locally there is none, so it falls back to "dev".
 */
const BUILD_ID = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev").slice(0, 7);

/**
 * The whole journey, not just the analysis half.
 *
 * The stepper used to stop at "Report", which quietly told people they were
 * finished at the moment before the product actually does anything. Connecting
 * the values to Google Ads is the last step and belongs on the map.
 */
const STEPS = [
  { key: "intake", label: "Your business" },
  { key: "upload", label: "Upload" },
  { key: "mapping", label: "Map columns" },
  { key: "report", label: "Your model" },
  { key: "connect", label: "Connect" },
] as const;

export type DiagnosticStep = (typeof STEPS)[number]["key"];

export function Stepper({ current }: { current: DiagnosticStep }) {
  const router = useRouter();
  const { reset } = useDiagnostic();
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-3">
        {/*
          Mark only. The wordmark plus five steps overflows the bar well before
          mobile widths, and the header is not where anyone learns the name.
        */}
        <Link href="/" className="shrink-0" aria-label="ValueBasedBidding — home">
          <LogoMark size={26} />
        </Link>

        {/* Five pills do not fit a phone, and a 200px-tall header is worse than
            not seeing every step name. Small screens get the same information
            in one line. */}
        <p className="ml-auto text-xs font-semibold text-[var(--muted)] md:hidden">
          <span className="text-[var(--primary)]">Step {currentIdx + 1}</span> of{" "}
          {STEPS.length} · {STEPS[currentIdx]?.label}
        </p>

        <ol className="ml-auto hidden flex-wrap items-center gap-1 md:flex">
          {STEPS.map((step, i) => {
            const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
            return (
              <li key={step.key} className="flex items-center gap-1">
                <span
                  className={
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors " +
                    (state === "active"
                      ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                      : state === "done"
                      ? "text-[var(--foreground)]"
                      : "text-[#a8b0c2]")
                  }
                >
                  <span
                    className={
                      "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold " +
                      (state === "active"
                        ? "bg-[var(--primary)] text-white"
                        : state === "done"
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[#e6e9f2] text-[#a8b0c2]")
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
            router.push("/diagnostic");
          }}
          className="btn btn-ghost shrink-0 text-xs"
        >
          Start over
        </button>

        {/* Build marker, so it is always obvious which version is deployed. */}
        <span
          className="mono hidden shrink-0 text-[10.5px] text-[#b6bdcc] sm:inline"
          title="Deployed commit"
        >
          {BUILD_ID}
        </span>
      </div>
    </header>
  );
}
