import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * The frame both blog screens sit in.
 *
 * Same header as the legal pages, with Blog added, so somebody arriving on an
 * article from a search result lands somewhere that is recognisably the same
 * site rather than on a detached content farm.
 *
 * `wide` is for the article, which carries a table of contents beside the
 * prose on a large screen and needs the room. Header, body and footer all
 * take the same width so their edges line up.
 */
export function BlogShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const width = wide ? "page-wide" : "page";

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className={`${width} flex items-center justify-between py-4`}>
          <Link href="/" aria-label="ValueBasedBidding home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-5 text-[13px] font-semibold">
            <Link href="/blog" className="text-[var(--muted)] hover:text-[var(--foreground)]">
              Blog
            </Link>
            <Link href="/diagnostic" className="text-[var(--primary)] hover:text-[var(--primary-hover)]">
              Try it
            </Link>
          </nav>
        </div>
      </header>

      <main className={`${width} flex-1 py-12`}>{children}</main>

      {/*
        The article's job is to answer a question somebody searched for. This
        is the one place it asks for anything, and it asks after the answer
        rather than interrupting it.
      */}
      <section className="border-t border-[var(--border)] bg-[var(--surface)]">
        <div className={`${width} py-12`}>
          <div className="max-w-[60ch]">
            <h2 className="h2">See what your own leads are worth</h2>
            <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--muted-strong)]">
              Read your closed deals and find out whether your lead values
              actually vary, and by how much. Nothing is stored, and your file is
              read in your browser.
            </p>
            <Link href="/diagnostic" className="btn btn-primary mt-6">
              Try it on a sample dataset <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
