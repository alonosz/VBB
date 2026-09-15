import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogShell } from "@/components/blog/BlogShell";
import { Markdown } from "@/components/blog/Markdown";
import { formatPostDate, listPosts, readPost } from "@/lib/blog/posts";

/**
 * One article.
 *
 * A server component with no client JavaScript in it at all: the markdown is
 * parsed during the build and what ships is the finished HTML. That is the
 * right shape for a page whose entire purpose is to be read by a stranger who
 * arrived from a search result.
 */

export async function generateStaticParams() {
  return (await listPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await readPost(slug);
  if (!post) return { title: "Not found · ValueBasedBidding" };

  return {
    title: `${post.title} · ValueBasedBidding`,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      publishedTime: post.date,
      authors: [post.author],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await readPost(slug);
  if (!post) notFound();

  return (
    <BlogShell>
      <article className="max-w-[70ch]">
        <p className="mono text-[12.5px] text-[var(--muted)]">
          {formatPostDate(post.date)} · {post.author}
        </p>
        <h1 className="h1 mt-3 text-balance">{post.title}</h1>

        <div className="mt-8">
          <Markdown source={post.body} />
        </div>
      </article>

      <p className="mt-14 text-[13.5px]">
        <Link href="/blog" className="font-semibold text-[var(--primary)] underline underline-offset-[3px]">
          All articles
        </Link>
      </p>

      {/*
        Structured data, because the point of writing this is to be found. Only
        facts that are already on the page, so nothing here can drift out of
        step with what a reader sees.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.description,
            datePublished: post.date,
            author: { "@type": "Person", name: post.author },
            publisher: { "@type": "Organization", name: "ValueBasedBidding" },
            mainEntityOfPage: `https://valuebasedbidding.com/blog/${post.slug}`,
          }),
        }}
      />
    </BlogShell>
  );
}
