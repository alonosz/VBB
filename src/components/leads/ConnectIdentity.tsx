"use client";

import { useState } from "react";
import { looksLikeEmail } from "@/lib/leads/leads";
import { forgetContactEmail, rememberContactEmail } from "@/lib/leads/contactEmail";

/**
 * Who is connecting, asked once, at the moment a credential is handed over.
 *
 * Not a signup. There is no password and no account: an address, so the
 * workspace this browser holds has a person attached to it, and that person
 * can be let back in from another machine. Asked here and nowhere earlier,
 * because somebody uploading a file has handed over nothing that needs a
 * name on it, and the landing page promised them exactly that.
 */
export function ConnectIdentity({
  email,
  onChange,
}: {
  email: string | null;
  onChange: (email: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!looksLikeEmail(draft)) {
      setInvalid(true);
      return;
    }
    const clean = draft.trim();
    rememberContactEmail(clean);
    onChange(clean);
  }

  if (email) {
    return (
      <p className="mt-3 text-[13px] text-[var(--muted)]">
        Connecting as <span className="font-semibold text-[var(--foreground)]">{email}</span>
        {" · "}
        <button
          type="button"
          onClick={() => {
            forgetContactEmail();
            setDraft(email);
            onChange(null);
          }}
          className="font-semibold text-[var(--primary)] underline underline-offset-[3px]"
        >
          change
        </button>
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3.5">
      <label htmlFor="connect-email" className="label block">
        Where should we send your access link?
      </label>
      <p className="mt-1 max-w-[58ch] text-[12.5px] text-[var(--muted)]">
        A connection is tied to this browser. With an address on it you can get
        back in from any device. No password, and nothing else.
      </p>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <input
          id="connect-email"
          type="email"
          autoComplete="email"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (invalid) setInvalid(false);
          }}
          placeholder="you@company.com"
          aria-invalid={invalid}
          aria-describedby={invalid ? "connect-email-error" : undefined}
          className="input w-full max-w-[22rem] text-[14px]"
        />
        <button type="submit" className="btn btn-secondary text-[13.5px]">
          Continue
        </button>
      </div>
      {invalid && (
        <p id="connect-email-error" role="alert" className="mt-1.5 text-[12.5px] font-semibold text-[var(--danger)]">
          That does not look like an email address.
        </p>
      )}
    </form>
  );
}
