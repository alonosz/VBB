"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { safeNext } from "@/lib/workspace/signup";
import { SignupForm } from "./SignupForm";

/**
 * The signup behind a direct link.
 *
 * Inside the flow the same form opens over the screen where the visitor is
 * standing; this page exists for a link somebody was sent, and returns them
 * to `next` when done.
 */
export function SignupView() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const error = params.get("error");
  const google = `/api/auth/google/start?next=${encodeURIComponent(next)}`;

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <header className="page-wide py-5">
        <Link href="/" aria-label="ValueBasedBidding home">
          <Logo size={34} showDotCom />
        </Link>
      </header>

      <main className="page-narrow flex-1 py-12">
        <h1 className="h1">Create your workspace</h1>
        <p className="lede mt-2.5 max-w-[56ch]">
          Your report and your connections live in a workspace with your name on
          it. A name and a work email. No password.
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-[13.5px] font-semibold text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="card mt-8 p-6 sm:p-7">
          <a href={google} className="btn btn-secondary w-full justify-center text-[15px]">
            Sign up with Google
          </a>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="label text-[var(--muted)]">or with email</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <SignupForm onDone={() => router.push(next)} />
          <p className="mt-5 text-[13px] text-[var(--muted)]">
            Already have a workspace?{" "}
            <a href={google} className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
              Log in with Google
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
