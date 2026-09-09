"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { SignupForm } from "./SignupForm";

/**
 * The signup, where the visitor is standing.
 *
 * It opens over the screen at the moment something needs an owner - a file
 * about to be read, a CRM or an ad account about to be connected. One
 * button, Google, which gives a verified identity and a way back in from
 * any device; or a name and a work email for anyone who would rather not.
 * Control goes straight back to what they were doing. Closing it cancels
 * the action and nothing else.
 */

const ASSURANCES = [
  "Read-only access. Nothing in your CRM or ad account is ever changed.",
  "No CRM record is stored. Your file is read in your browser.",
  "Works with HubSpot, Salesforce, Pipedrive, Close, or any CSV.",
];

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.4 14.4 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function SignupModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const [withEmail, setWithEmail] = useState(false);

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

  // Back to exactly this screen once Google has said who they are.
  const here = typeof window === "undefined" ? "/diagnostic" : window.location.pathname;
  const google = `/api/auth/google/start?next=${encodeURIComponent(here)}`;

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
        className="animate-page-in card grid w-full max-w-[56rem] overflow-hidden p-0 shadow-[var(--shadow-md)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]"
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <Logo size={26} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-full text-[18px] leading-none text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)] md:hidden"
            >
              ×
            </button>
          </div>

          <h2 id="signup-title" className="h2 mt-5">
            Create your workspace
          </h2>
          <p className="mt-1.5 max-w-[44ch] text-[14px] text-[var(--muted)]">
            Your report and your connections live in a workspace with your name
            on it. No password.
          </p>

          <a
            href={google}
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-3 text-[15px] font-bold text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/50 hover:bg-[var(--primary-softer)]"
          >
            <GoogleMark />
            Sign up with Google
          </a>

          {withEmail ? (
            <div className="mt-6">
              <SignupForm onDone={onDone} autoFocus />
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-[var(--border)]" />
              <button
                type="button"
                onClick={() => setWithEmail(true)}
                className="text-[13px] font-semibold text-[var(--primary)] underline underline-offset-[3px]"
              >
                or continue with email
              </button>
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          )}

          <p className="mt-6 text-[13px] text-[var(--muted)]">
            Already have a workspace?{" "}
            <a href={google} className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
              Log in with Google
            </a>
          </p>
          <p className="mt-2 text-[12px] text-[var(--muted)]">
            By continuing you agree to the{" "}
            <a href="/terms" className="underline underline-offset-[3px]">Terms</a> and{" "}
            <a href="/privacy" className="underline underline-offset-[3px]">Privacy Policy</a>.
          </p>
        </div>

        <div className="panel-navy relative hidden flex-col justify-between p-8 md:flex">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-[18px] leading-none transition-colors hover:bg-white/10"
            style={{ color: "var(--on-navy-muted)" }}
          >
            ×
          </button>
          <div>
            <p className="label" style={{ color: "var(--on-navy-muted)" }}>
              What you are signing up for
            </p>
            <p className="mt-3 text-[20px] font-extrabold leading-snug tracking-[-.02em]" style={{ color: "var(--on-navy)" }}>
              Google bids on what each lead is worth, from your own history.
            </p>
          </div>
          <ul className="mt-8 grid gap-3">
            {ASSURANCES.map((line) => (
              <li key={line} className="flex gap-2.5 text-[13.5px]" style={{ color: "var(--on-navy-muted)" }}>
                <span
                  aria-hidden
                  className="mt-[2px] flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/20 text-[11px] font-bold text-[var(--accent)]"
                >
                  ✓
                </span>
                <span className="max-w-[34ch]">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
