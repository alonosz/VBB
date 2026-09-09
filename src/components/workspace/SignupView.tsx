"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Logo } from "@/components/brand/Logo";
import { looksLikeEmail } from "@/lib/leads/leads";
import { readContactEmail, rememberContactEmail } from "@/lib/leads/contactEmail";
import { readWorkspaceKey, rememberWorkspaceKey, rememberWorkspaceName } from "@/lib/workspace/clientKey";
import { safeNext } from "@/lib/workspace/signup";

/**
 * The one screen that asks who you are.
 *
 * Reached at the first moment something needs an owner: a CRM or an ad
 * account about to be connected. A name and a work email, no password, and
 * they are sent back to exactly where they were. Somebody who only uploads
 * a file never sees this, because a file never leaves their browser.
 */
export function SignupView() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => (typeof window === "undefined" ? "" : readContactEmail() ?? ""));
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError("Tell us your name.");
      return;
    }
    if (!looksLikeEmail(email)) {
      setError("That does not look like an email address.");
      return;
    }
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, workspaceKey: readWorkspaceKey() }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.ok !== true) {
        setError(
          res.status === 401
            ? "This browser's access no longer works. Open the link we sent you, or clear this site's data and try again."
            : typeof data.error === "string" ? data.error : "We couldn't create your workspace. Try again."
        );
        setState("idle");
        return;
      }
      if (typeof data.workspaceKey === "string") rememberWorkspaceKey(data.workspaceKey);
      rememberContactEmail(typeof data.email === "string" ? data.email : email.trim());
      rememberWorkspaceName(typeof data.name === "string" ? data.name : name.trim());
      router.push(next);
    } catch {
      setError("We couldn't reach the server. Try again.");
      setState("idle");
    }
  }

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
          Connecting a CRM or an ad account needs a workspace with a person on it.
          A name and a work email. No password.
        </p>

        <form onSubmit={submit} noValidate className="card mt-8 p-6 sm:p-7">
          <label htmlFor="signup-name" className="label block">
            Your name
          </label>
          <input
            id="signup-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dana Klein"
            className="input mt-1.5 w-full text-[15px]"
          />

          <label htmlFor="signup-email" className="label mt-5 block">
            Work email
          </label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="input mt-1.5 w-full text-[15px]"
          />

          {error && (
            <p role="alert" className="mt-3 text-[13px] font-semibold text-[var(--danger)]">
              {error}
            </p>
          )}

          <button type="submit" disabled={state === "sending"} className="btn btn-primary btn-lg mt-6">
            {state === "sending" ? "Creating…" : "Create your workspace"}
            {state !== "sending" && <ArrowIcon />}
          </button>

          <p className="mt-4 max-w-[56ch] text-[12.5px] text-[var(--muted)]">
            Your email is how we let you back into your workspace from another
            device and how we get in touch about it. Nothing else, and no
            newsletter. Nothing from your CRM is stored with it.{" "}
            <Link href="/privacy" className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
              How we handle data
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
