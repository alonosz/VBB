import Link from "next/link";
import { MetaRow } from "@/components/blog/Meta";
import { PostVisual } from "@/components/blog/PostVisual";
import { formatPostDate, type PostMeta } from "@/lib/blog/posts";

/**
 * One post in a grid: picture, kind and length, title, standfirst, date.
 *
 * Shared by the blog index and the strip on the landing page, so an article
 * looks the same wherever it is offered. The heading level is the caller's,
 * because on the index a card's title is a section of the page and on the
 * landing page it sits under a section heading of its own.
 */
export function PostCard({
  post,
  sizes,
  heading: Heading = "h2",
}: {
  post: PostMeta;
  /** The image's share of the viewport per breakpoint, for next/image. */
  sizes: string;
  heading?: "h2" | "h3";
}) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="card card-hover group flex h-full flex-col overflow-hidden"
    >
      <PostVisual post={post} sizes={sizes} className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <MetaRow post={post} />
        <Heading className="mt-3 text-[19px] font-bold leading-snug tracking-[-.015em] text-balance group-hover:text-[var(--primary)]">
          {post.title}
        </Heading>
        <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-[var(--muted-strong)]">
          {post.description}
        </p>
        <p className="mono mt-auto pt-5 text-[12px] text-[var(--muted)]">{formatPostDate(post.date)}</p>
      </div>
    </Link>
  );
}
