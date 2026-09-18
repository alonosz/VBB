"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { readContactEmail } from "@/lib/leads/contactEmail";
import { readWorkspaceKey, readWorkspaceName } from "@/lib/workspace/clientKey";

/**
 * A small sign in the header that this browser holds a workspace.
 *
 * This replaced a full-width bar under the header that announced the
 * workspace by name every time its owner opened the front page. Once was
 * useful; every visit was an advert taking the top of the page. The chip is
 * the same fact at header scale: initials, a first name, a green dot, and
 * a way into the workspace. A stranger sees nothing here.
 *
 * Read as an external store so the server, which cannot know, renders
 * nothing and the browser fills in without a flash.
 */
const never = () => () => {};

interface Who {
  name: string;
  email: string | null;
}

/*
 * React compares snapshots by identity, so a function that built a fresh
 * object on every call would look like a store that never settles. The
 * last answer is kept and handed back again while the facts are unchanged.
 */
let last: { key: string; value: Who | null } | null = null;

function who(): Who | null {
  const hasKey = Boolean(readWorkspaceKey());
  const name = readWorkspaceName();
  const email = readContactEmail();
  const key = `${hasKey}|${name ?? ""}|${email ?? ""}`;
  if (last && last.key === key) return last.value;
  // A key with no name and no address is an invite that has not been
  // claimed by anyone yet; nothing to put a face on.
  const value: Who | null = hasKey && (name || email) ? { name: name || (email as string), email } : null;
  last = { key, value };
  return value;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (name.includes("@")) return name[0].toUpperCase();
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export function AccountChip({ className = "" }: { className?: string }) {
  const me = useSyncExternalStore(never, who, () => null);
  if (!me) return null;

  const first = me.name.includes("@") ? me.name.split("@")[0] : me.name.split(/\s+/)[0];

  return (
    <Link
      href="/workspace"
      title={me.email ? `Signed in as ${me.email}` : "Your workspace"}
      className={`group flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1 pl-1 pr-3 text-[13px] max-sm:pr-1 font-semibold text-[var(--foreground)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--primary)] ${className}`}
    >
      <span className="relative flex size-6 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[10.5px] font-bold text-[var(--primary)]">
        {initialsOf(me.name)}
        <span
          aria-hidden
          className="absolute -bottom-px -right-px size-2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]"
        />
      </span>
      <span className="max-w-[9rem] truncate max-sm:hidden">{first}</span>
    </Link>
  );
}
