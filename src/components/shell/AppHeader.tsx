import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, LogoMark } from "@/components/brand/Logo";

/**
 * The bar every screen sits under.
 *
 * One header for both modes, with a different middle: the five-step progress
 * during setup, product navigation once a workspace is running. Keeping the
 * frame constant and changing only what it contains is what tells a customer
 * they are in the same product doing a different thing.
 *
 * The build marker stays — knowing which version is deployed has already saved
 * this project an afternoon more than once.
 */

const BUILD_ID = (process.env.NEXT_PUBLIC_COMMIT_SHA ?? "dev").slice(0, 7);

export function AppHeader({
  center,
  right,
  wide = false,
}: {
  center?: ReactNode;
  right?: ReactNode;
  wide?: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[rgba(255,255,255,0.86)] backdrop-blur-md">
      <div
        className={`${wide ? "page-wide" : "page"} flex items-center gap-4 py-3`}
      >
        <Link
          href="/"
          className="shrink-0"
          aria-label="ValueBasedBidding — home"
        >
          {/* The wordmark needs room the stepper also wants; below lg the mark
              carries the brand on its own. */}
          <span className="hidden lg:block">
            <Logo size={26} />
          </span>
          <span className="lg:hidden">
            <LogoMark size={24} />
          </span>
        </Link>

        {center && <div className="min-w-0 flex-1">{center}</div>}
        {!center && <div className="flex-1" />}

        <div className="flex shrink-0 items-center gap-2">
          {right}
          <span
            className="mono hidden text-[10px] tracking-wide text-[#aab3c7] sm:inline"
            title="Deployed build"
          >
            {BUILD_ID}
          </span>
        </div>
      </div>
    </header>
  );
}
