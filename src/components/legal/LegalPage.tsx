import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

/**
 * The shell both legal pages sit in.
 *
 * Deliberately the product's own typography rather than a wall of 9px grey
 * text. A privacy policy nobody can read is a policy nobody has read, and this
 * one is worth reading: it is shorter than most because the product genuinely
 * holds less than most.
 */
export function LegalPage({
  title,
  updated,
  lede,
  children,
}: {
  title: string;
  updated: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="page flex items-center justify-between py-4">
          <Link href="/" aria-label="ValueBasedBidding home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-5 text-[13px] font-semibold">
            <Link href="/privacy" className="text-[var(--muted)] hover:text-[var(--foreground)]">
              Privacy
            </Link>
            <Link href="/terms" className="text-[var(--muted)] hover:text-[var(--foreground)]">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="page flex-1 py-12">
        <p className="label">Legal</p>
        <h1 className="h1 mt-2.5 max-w-[20ch]">{title}</h1>
        <p className="mono mt-2 text-[12.5px] text-[var(--muted)]">
          Last updated {updated}
        </p>
        <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-[var(--muted-strong)]">
          {lede}
        </p>

        <div className="legal mt-10 max-w-[70ch]">{children}</div>

        <p className="mt-14 max-w-[70ch] text-[13px] text-[var(--muted)]">
          Questions about anything on this page:{" "}
          <a
            href="mailto:alon@bettersignals.co"
            className="font-semibold text-[var(--primary)] underline underline-offset-2"
          >
            alon@bettersignals.co
          </a>
        </p>
      </main>
    </div>
  );
}

/** A titled block. Used instead of raw h2s so spacing stays consistent. */
export function Clause({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <h2 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
      <div className="mt-2.5 grid gap-3 text-[14.5px] leading-relaxed text-[var(--muted-strong)]">
        {children}
      </div>
    </section>
  );
}
