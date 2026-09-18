import Link from "next/link";

/**
 * One quiet line in the middle of an article.
 *
 * Placed between sections, never inside one, at the point where a reader who
 * is still here has decided the piece is about them. It asks the question
 * the whole blog exists to raise and offers the check, in the article's own
 * grey rather than a button, so it reads as an aside from the author and not
 * an advert dropped into the prose.
 */
export function MidCta() {
  return (
    <aside
      aria-label="Try it on your data"
      className="my-10 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-sunken)] px-5 py-4 text-[14px] leading-relaxed text-[var(--muted-strong)]"
    >
      Wondering whether this applies to your leads? Run a CRM export through the free check and
      see whether your lead values vary, and by how much. Nothing is stored.{" "}
      <Link
        href="/diagnostic"
        className="whitespace-nowrap font-semibold text-[var(--primary)] hover:text-[var(--primary-hover)]"
      >
        Check your data <span aria-hidden>&rarr;</span>
      </Link>
    </aside>
  );
}
