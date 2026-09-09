"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { looksLikeEmail } from "@/lib/leads/leads";
import { readContactEmail, rememberContactEmail } from "@/lib/leads/contactEmail";
import { readWorkspaceKey, rememberWorkspaceKey, rememberWorkspaceName } from "@/lib/workspace/clientKey";

/**
 * The signup itself: a name and a work email, no password.
 *
 * One form, used inside the modal that appears at the first moment a
 * workspace needs an owner and on the standalone page behind a direct link.
 * On success the browser keeps the key, the address and the name, and the
 * caller decides what happens next.
 */
export function SignupForm({
  onDone,
  autoFocus = false,
}: {
  onDone: (email: string) => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => (typeof window === "undefined" ? "" : readContactEmail() ?? ""));
  const [sending, setSending] = useState(false);
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
    setSending(true);
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
        setSending(false);
        return;
      }
      if (typeof data.workspaceKey === "string") rememberWorkspaceKey(data.workspaceKey);
      const clean = typeof data.email === "string" ? data.email : email.trim();
      rememberContactEmail(clean);
      rememberWorkspaceName(typeof data.name === "string" ? data.name : name.trim());
      onDone(clean);
    } catch {
      setError("We couldn't reach the server. Try again.");
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="signup-name" className="label block">
        Your name
      </label>
      <input
        id="signup-name"
        autoComplete="name"
        autoFocus={autoFocus}
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

      <button type="submit" disabled={sending} className="btn btn-primary btn-lg mt-6 w-full sm:w-auto">
        {sending ? "Creating…" : "Create your workspace"}
        {!sending && <ArrowIcon />}
      </button>

      <p className="mt-4 max-w-[52ch] text-[12.5px] text-[var(--muted)]">
        Your email is how we let you back into your workspace from another
        device and how we get in touch about it. Nothing else, and no
        newsletter. Nothing from your CRM is stored with it.{" "}
        <Link href="/privacy" className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
          How we handle data
        </Link>
      </p>
    </form>
  );
}
