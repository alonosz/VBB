"use client";

import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { AppHeader } from "@/components/shell/AppHeader";

/**
 * Setup mode: the five-step header.
 *
 * The frame comes from `AppHeader` so setup and the running workspace are
 * visibly the same product; only the middle differs. Here the middle is the
 * journey, because during setup the one thing a customer needs to know is how
 * much is left.
 *
 * The whole journey, not just the analysis half. The stepper used to stop at
 * "Report", which quietly told people they were finished at the moment before
 * the product actually does anything. Connecting the values to Google Ads is
 * the last step and belongs on the map.
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
  const pct = ((currentIdx + 1) / STEPS.length) * 100;

  return (
    <AppHeader
      wide
      center={
        <>
          {/* Five pills do not fit a phone, and a 200px-tall header is worse
              than not seeing every step name. Small screens get the same
              information as one line plus a fill. */}
          <div className="md:hidden">
            <p className="flex items-baseline justify-between gap-2 text-xs font-semibold text-[var(--muted)]">
              <span className="text-[var(--foreground)]">
                {STEPS[currentIdx]?.label}
              </span>
              <span className="mono text-[10.5px]">
                {currentIdx + 1}/{STEPS.length}
              </span>
            </p>
            <span
              className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
              aria-hidden
            >
              <span
                className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-[var(--base)] ease-[var(--ease)]"
                style={{ width: `${pct}%` }}
              />
            </span>
          </div>

          <ol
            className="hidden items-center justify-center gap-0.5 md:flex"
            aria-label={`Step ${currentIdx + 1} of ${STEPS.length}`}
          >
            {STEPS.map((step, i) => {
              const state =
                i < currentIdx ? "done" : i === currentIdx ? "active" : "todo";
              return (
                <li key={step.key} className="flex items-center">
                  <span
                    aria-current={state === "active" ? "step" : undefined}
                    className={
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors duration-[var(--fast)] " +
                      (state === "active"
                        ? "bg-[var(--primary-soft)] text-[var(--primary-deep)]"
                        : state === "done"
                          ? "text-[var(--muted-strong)]"
                          : "text-[var(--muted)]/60")
                    }
                  >
                    <span
                      className={
                        "mono flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold " +
                        (state === "active"
                          ? "bg-[var(--primary)] text-white"
                          : state === "done"
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--surface-sunken)] text-[var(--muted)]")
                      }
                    >
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span className="hidden lg:inline">{step.label}</span>
                  </span>
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden
                      className={
                        "mx-0.5 h-px w-3 lg:w-5 " +
                        (i < currentIdx
                          ? "bg-[var(--accent)]/45"
                          : "bg-[var(--border)]")
                      }
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </>
      }
      right={
        /* Deliberately quiet. Discarding the work is always reachable and never
           competes with the button that moves you forward. */
        <button
          type="button"
          onClick={() => {
            reset();
            router.push("/diagnostic");
          }}
          className="btn btn-ghost btn-sm"
        >
          Start over
        </button>
      }
    />
  );
}
