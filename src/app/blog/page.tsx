import Link from "next/link";
import { BlogShell } from "@/components/blog/BlogShell";
import { Byline, MetaRow } from "@/components/blog/Meta";
import { PostVisual } from "@/components/blog/PostVisual";
import { formatPostDate, listPosts, type PostMeta } from "@/lib/blog/posts";

export const metadata = {
  title: "Blog · ValueBasedBidding",
  description:
    "Writing on value-based bidding for lead generation: estimating what a lead is worth, sending those values to Google Ads, and checking whether the bids brought better business.",
  alternates: { canonical: "/blog" },
};

/**
 * The newest post, at the size it deserves.
 *
 * Image beside the words on a wide screen, above them on a phone. It is the
 * one thing on the page that gets to be big, so the rest can be a grid.
 */
function Featured({ post }: { post: PostMeta }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="card card-hover group grid overflow-hidden md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <PostVisual
        post={post}
        priority
        sizes="(min-width: 768px) 40vw, 100vw"
        className="aspect-[16/10] md:aspect-auto md:min-h-[19rem]"
      />
      <div className="flex flex-col justify-center p-6 sm:p-8">
        <MetaRow post={post} />
        <h2 className="mt-3.5 text-[26px] font-extrabold leading-[1.15] tracking-[-.022em] text-balance group-hover:text-[var(--primary)] sm:text-[28px]">
          {post.title}
        </h2>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-[var(--muted-strong)]">
          {post.description}
        </p>
        <div className="mt-6">
          <Byline post={post} />
        </div>
      </div>
    </Link>
  );
}

function Card({ post }: { post: PostMeta }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="card card-hover group flex h-full flex-col overflow-hidden"
    >
      <PostVisual post={post} sizes="(min-width: 640px) 50vw, 100vw" className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <MetaRow post={post} />
        <h2 className="mt-3 text-[19px] font-bold leading-snug tracking-[-.015em] text-balance group-hover:text-[var(--primary)]">
          {post.title}
        </h2>
        <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-[var(--muted-strong)]">
          {post.description}
        </p>
        <p className="mono mt-auto pt-5 text-[12px] text-[var(--muted)]">{formatPostDate(post.date)}</p>
      </div>
    </Link>
  );
}

export default async function BlogIndex() {
  const posts = await listPosts();
  const [featured, ...rest] = posts;

  return (
    <BlogShell>
      <p className="label">Blog</p>
      <h1 className="h1 mt-2.5 max-w-[22ch]">Value-based bidding, written down</h1>
      <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-[var(--muted-strong)]">
        What we have worked out about pricing leads from CRM history, and where
        the method stops being trustworthy. Written by the person who built the
        tool, which is a reason to read it and a reason to be sceptical of it.
      </p>

      {!featured ? (
        <p className="mt-12 text-[15px] text-[var(--muted)]">Nothing published yet.</p>
      ) : (
        <>
          <div className="mt-10">
            <Featured post={featured} />
          </div>

          {rest.length > 0 && (
            <ul className="mt-6 grid gap-5 sm:grid-cols-2">
              {rest.map((post) => (
                <li key={post.slug}>
                  <Card post={post} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </BlogShell>
  );
}
