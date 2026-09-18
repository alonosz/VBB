import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * One quiet line in the middle of an article.
 *
 * Placed between sections, never inside one, at the point where a reader who
 * is still here has decided the piece is about them. It asks the question
 * the whole blog exists to raise and offers the check, on the quiet
 * secondary button rather than the gradient one, so it reads as an aside
 * from the author and not an advert dropped into the prose.
 */
export function MidCta() {
  return (
    <aside
      aria-label="Try it on your data"
      className="my-10 flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-sunken)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <p className="max-w-[52ch] text-[14px] leading-relaxed text-[var(--muted-strong)]">
        Wondering whether this applies to your leads? Run a CRM export through the free check and
        see whether your lead values vary, and by how much. Nothing is stored.
      </p>
      <Link href="/diagnostic" className="btn btn-secondary btn-sm shrink-0 self-start sm:self-auto">
        Check your data <ArrowIcon variant="onLight" />
      </Link>
    </aside>
  );
}
