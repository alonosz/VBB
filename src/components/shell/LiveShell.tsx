"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/shell/AppHeader";

/**
 * Live mode: the header a customer sees once their model is running.
 *
 * Setup and live mode share the frame and differ in the middle. Setup shows
 * how much is left; here there is nothing left, so the middle is navigation
 * and the right-hand side says the model is live. That contrast is the whole
 * signal - a customer should be able to tell which mode they are in from a
 * glance at the top bar, without reading a word.
 *
 * Navigation is deliberately short. Overview is the home for a running
 * workspace and everything it reports links back into the setup screens that
 * own that step, rather than duplicating them as new pages.
 */

const NAV = [
  { href: "/workspace", label: "Overview" },
  { href: "/evaluation", label: "Evaluation" },
  { href: "/feed-status", label: "Feed" },
  { href: "/diagnostic/report", label: "Model" },
] as const;

export function LiveShell({
  children,
  status,
}: {
  children: ReactNode;
  /** Optional live-state chip, e.g. a health badge from the overview. */
  status?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <>
      <AppHeader
        wide
        center={
          <nav aria-label="Workspace" className="flex justify-center">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={
                        "block rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors duration-[var(--fast)] " +
                        (active
                          ? "bg-[var(--primary-soft)] text-[var(--primary-deep)]"
                          : "text-[var(--muted-strong)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]")
                      }
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        }
        right={status}
      />
      <main className="page-wide animate-page-in flex-1 py-10">{children}</main>
    </>
  );
}
