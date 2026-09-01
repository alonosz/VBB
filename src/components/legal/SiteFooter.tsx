import Link from "next/link";

/**
 * Where the legal pages are found from.
 *
 * Not decoration: Google's OAuth verification reviewer looks for a privacy
 * policy reachable from the site, and a link that exists only in a Cloud
 * Console form is a link nobody can check. It also happens to be where a
 * cautious buyer looks first.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="page flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-6">
        <p className="text-[12.5px] text-[var(--muted)]">
          ValueBasedBidding, by BetterSignals
        </p>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] font-semibold">
          <Link href="/privacy" className="text-[var(--muted)] hover:text-[var(--foreground)]">
            Privacy
          </Link>
          <Link href="/terms" className="text-[var(--muted)] hover:text-[var(--foreground)]">
            Terms
          </Link>
          <a
            href="mailto:alon@bettersignals.co"
            className="text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
