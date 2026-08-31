"use client";

import { useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { looksLikeEmail } from "@/lib/leads/leads";
import type { LeadSource } from "@/lib/leads/leads";

/**
 * One box, asking for one thing, in exchange for something.
 *
 * It appears in exactly one place: the bottom of step 5, once they have their
 * model, their feed and nothing left to do here. An address given before any
 * value has been received is the weakest lead this product can collect, and on
 * the landing page it is worse than weak - it is a box nobody fills in,
 * sitting under a line promising this costs nothing to try.
 *
 * The `source` prop exists because that judgement could change and the schema
 * already allows the other values. Today only "report" is wired.
 *
 * The consent line is not decoration. Collecting an address in order to get in
 * touch means saying so at the point of collection, and saying it plainly is
 * cheaper than a policy nobody reads.
 *
 * Failure is silent by design. Nothing the visitor is doing depends on this,
 * and an error about our database in the middle of their evaluation costs more
 * than a lost address. The route answers the same way whatever happens, so
 * there is nothing here to distinguish anyway.
 */

export function EmailCapture({
  source,
  step,
  title,
  body,
  cta = "Send it",
  placeholder = "you@company.com",
  onNavy = false,
}: {
  source: LeadSource;
  /** Where they were when they left it. The half that makes the address useful. */
  step?: string;
  title: string;
  body: string;
  cta?: string;
  placeholder?: string;
  onNavy?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "invalid">("idle");

  const ink = onNavy ? "var(--on-navy)" : "var(--foreground)";
  const softInk = onNavy ? "var(--on-navy-muted)" : "var(--muted)";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!looksLikeEmail(email)) {
      setState("invalid");
      return;
    }

    setState("sending");
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, step }),
      });
    } catch {
      // Deliberately swallowed. See the note above.
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-[2px] flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]"
        >
          ✓
        </span>
        <p className="max-w-[52ch] text-[13.5px]" style={{ color: softInk }}>
          <span className="font-semibold" style={{ color: ink }}>
            Got it.
          </span>{" "}
          We will only use it to get in touch about this, and you can ask us to
          delete it at any time.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[14px] font-bold" style={{ color: ink }}>
        {title}
      </p>
      <p className="mt-1 max-w-[54ch] text-[13.5px]" style={{ color: softInk }}>
        {body}
      </p>

      {/*
        noValidate so our message is the one they see. The browser's own
        bubble for type="email" fires first otherwise, and it is a tooltip
        that vanishes, phrased by the browser, in the browser's language
        rather than ours. type="email" stays for the phone keyboard.
      */}
      <form onSubmit={submit} noValidate className="mt-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-[15rem]">
          <label htmlFor={`email-${source}`} className="sr-only">
            Your email address
          </label>
          <input
            id={`email-${source}`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "invalid") setState("idle");
            }}
            placeholder={placeholder}
            aria-invalid={state === "invalid"}
            aria-describedby={state === "invalid" ? `email-${source}-error` : undefined}
            className="input w-full text-[14px]"
          />
        </div>
        <button
          type="submit"
          disabled={state === "sending"}
          className="btn btn-primary shrink-0 text-[13.5px]"
        >
          {state === "sending" ? "Sending…" : cta}
          {state !== "sending" && <ArrowIcon />}
        </button>
      </form>

      {state === "invalid" && (
        <p
          id={`email-${source}-error`}
          role="alert"
          className="mt-1.5 text-[12.5px] font-semibold text-[var(--danger)]"
        >
          That does not look like an email address.
        </p>
      )}

      <p className="mt-2 max-w-[54ch] text-[12px]" style={{ color: softInk }}>
        One address, nothing else. No newsletter, and nothing from your file is
        sent or stored with it.
      </p>
    </div>
  );
}
