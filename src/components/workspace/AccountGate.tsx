"use client";

import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * What stands in front of a connect button until the workspace has an owner.
 *
 * Not a form. The signup is its own page, and this only says that one is
 * needed and takes them there, then brings them back to exactly this spot.
 * With an owner in place it is one quiet line.
 */
export function AccountGate({
  email,
  next,
  what,
}: {
  email: string | null;
  /** Where to come back to after signing up. */
  next: string;
  /** "HubSpot" or "Google Ads", for the sentence. */
  what: string;
}) {
  const href = `/signup?next=${encodeURIComponent(next)}`;

  if (email) {
    return (
      <p className="mt-3 text-[13px] text-[var(--muted)]">
        Signed up as <span className="font-semibold text-[var(--foreground)]">{email}</span>
        {" · "}
        <Link href={href} className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
          not you?
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[14px] font-bold">Connecting {what} needs a workspace</p>
      <p className="mt-1 max-w-[56ch] text-[13px] text-[var(--muted)]">
        A name and a work email, so the connection has an owner and you can
        get back to it from any device. No password. Takes ten seconds and
        brings you straight back here.
      </p>
      <Link href={href} className="btn btn-primary mt-3.5 text-[13.5px]">
        Create your workspace <ArrowIcon />
      </Link>
    </div>
  );
}
