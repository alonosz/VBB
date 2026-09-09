"use client";

import { useEffect } from "react";
import { Logo } from "@/components/brand/Logo";
import { SignupForm } from "./SignupForm";

/**
 * The signup, where the visitor is standing.
 *
 * It opens over the screen at the moment something needs an owner - a file
 * about to be read, a CRM or an ad account about to be connected - takes a
 * name and a work email, and hands control straight back to what they were
 * doing. No page change, nothing to find their way back from. Closing it
 * cancels the action and nothing else.
 */
export function SignupModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(10, 14, 30, 0.45)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signup-title"
        className="animate-page-in card w-full max-w-[30rem] p-6 shadow-[var(--shadow-md)] sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <Logo size={26} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-full text-[18px] leading-none text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]"
          >
            ×
          </button>
        </div>

        <h2 id="signup-title" className="h2 mt-5">
          Create your workspace
        </h2>
        <p className="mt-1.5 max-w-[46ch] text-[14px] text-[var(--muted)]">
          Your report and your connections live in a workspace with your name on
          it. Ten seconds, and no password.
        </p>

        <div className="mt-6">
          <SignupForm onDone={onDone} autoFocus />
        </div>
      </div>
    </div>
  );
}
