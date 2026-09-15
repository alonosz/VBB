import Link from "next/link";
import { BlogShell } from "@/components/blog/BlogShell";
import { formatPostDate, listPosts } from "@/lib/blog/posts";

export const metadata = {
  title: "Blog · ValueBasedBidding",
  description:
    "Writing on value-based bidding for lead generation: estimating what a lead is worth, sending those values to Google Ads, and checking whether the bids brought better business.",
  alternates: { canonical: "/blog" },
};

export default async function BlogIndex() {
  const posts = await listPosts();

  return (
    <BlogShell>
      <p className="label">Blog</p>
      <h1 className="h1 mt-2.5 max-w-[22ch]">Value-based bidding, written down</h1>
      <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-[var(--muted-strong)]">
        What we have worked out about pricing leads from CRM history, and where
        the method stops being trustworthy. Written by the person who built the
        tool, which is a reason to read it and a reason to be sceptical of it.
      </p>

      {posts.length === 0 ? (
        <p className="mt-12 text-[15px] text-[var(--muted)]">Nothing published yet.</p>
      ) : (
        <ul className="mt-12 grid max-w-[70ch] gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--border)]">
          {posts.map((post) => (
            <li key={post.slug} className="bg-[var(--surface)]">
              <Link href={`/blog/${post.slug}`} className="group block p-6 transition-colors hover:bg-[var(--primary-softer)]">
                <p className="mono text-[12px] text-[var(--muted)]">{formatPostDate(post.date)}</p>
                <h2 className="mt-2 text-[19px] font-bold leading-snug tracking-[-.015em] text-balance group-hover:text-[var(--primary)]">
                  {post.title}
                </h2>
                <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--muted-strong)]">
                  {post.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlogShell>
  );
}
