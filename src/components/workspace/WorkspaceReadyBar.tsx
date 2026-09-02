"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

import { readWorkspaceKey, readWorkspaceName } from "@/lib/workspace/clientKey";

/**
 * "Your workspace is ready", said on the front page.
 *
 * An invite used to end on its own confirmation screen, which meant a design
 * partner was handed a link and never saw a word of what the product does -
 * the pitch, the comparison, the whole reason somebody would spend an
 * afternoon on this. They arrived already inside it.
 *
 * So the invite now hands them to the front page like anyone else, and this
 * bar is the difference between them and a stranger: it confirms the link
 * worked, names their workspace, and is the only thing on the page that knows
 * they have one. Everything below it is the same page everybody sees.
 *
 * Rendered after mount rather than on the server, because whether it belongs
 * on the page is a fact only the browser holds - hence the store read rather
 * than an effect that sets state, which would paint the page once without it
 * and once with.
 */

/** Nothing changes it mid-visit: the invite was spent before this page. */
const never = () => () => {};

const server = () => null;

function greeting(): string | null {
  if (!readWorkspaceKey()) return null;
  // Falls back to a generic line rather than hiding: the confirmation is the
  // point, and the name is the decoration.
  return readWorkspaceName() || "Your workspace";
}

export function WorkspaceReadyBar() {
  const name = useSyncExternalStore(never, greeting, server);

  if (!name) return null;

  return (
    <div className="page-wide pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-4 py-3">
        <p className="text-[13.5px]">
          <span className="font-bold">{name}</span>
          <span className="text-[var(--muted-strong)]">
            {" "}
            is set up. Nothing to install, and no password to remember.
          </span>
        </p>
        <Link href="/diagnostic" className="btn btn-primary btn-sm shrink-0">
          Start
        </Link>
      </div>
    </div>
  );
}
