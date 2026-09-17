import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogShell } from "@/components/blog/BlogShell";
import { Markdown, outline } from "@/components/blog/Markdown";
import { Byline, MetaRow } from "@/components/blog/Meta";
import { PostVisual } from "@/components/blog/PostVisual";
import { listPosts, readPost, type PostMeta } from "@/lib/blog/posts";

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

  // The cover doubles as the picture a link unfurls into, when there is one.
  const images = post.cover ? [{ url: post.cover, alt: post.coverAlt }] : undefined;

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
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: post.title,
      description: post.description,
      images: images?.map((i) => i.url),
    },
  };
}

/** The other posts, for the foot of this one. */
function Related({ posts }: { posts: PostMeta[] }) {
  if (posts.length === 0) return null;
  return (
    <section className="mt-16 border-t border-[var(--border)] pt-10">
      <p className="label">More articles</p>
      <ul className="mt-5 grid gap-5 sm:grid-cols-2">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className="card card-hover group flex h-full flex-col overflow-hidden"
            >
              <PostVisual post={post} sizes="(min-width: 640px) 33vw, 100vw" className="aspect-[16/8]" />
              <div className="flex flex-1 flex-col p-5">
                <MetaRow post={post} />
                <h3 className="mt-2.5 text-[16px] font-semibold leading-snug tracking-[-.015em] text-balance group-hover:text-[var(--primary)]">
                  {post.title}
                </h3>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await readPost(slug);
  if (!post) notFound();

  const sections = outline(post.body);
  const others = (await listPosts()).filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <BlogShell wide>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16">
        <div className="min-w-0">
          <article className="max-w-[70ch]">
            <MetaRow post={post} />
            <h1 className="mt-4 text-[clamp(1.9rem,1.3rem+1.8vw,2.55rem)] font-bold leading-[1.08] tracking-[-.03em] text-balance">
              {post.title}
            </h1>
            <div className="mt-6">
              <Byline post={post} />
            </div>

            <PostVisual
              post={post}
              priority
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="mt-8 aspect-[5/2] rounded-[var(--radius-lg)]"
            />

            <div className="mt-9">
              <Markdown source={post.body} />
            </div>
          </article>

          <Related posts={others} />
        </div>

        {/*
          Only where there is room for it, and only where there is enough of
          an article to need one. On a phone the headings themselves are the
          map.
        */}
        {sections.length >= 3 && (
          <aside className="hidden lg:block">
            <nav aria-label="In this article" className="sticky top-24">
              <p className="label">In this article</p>
              <ol className="mt-3 grid gap-2 border-l border-[var(--border)]">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="-ml-px block border-l-2 border-transparent pl-3.5 text-[13px] leading-snug text-[var(--muted)] transition-colors hover:border-[var(--primary)] hover:text-[var(--foreground)]"
                    >
                      {s.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        )}
      </div>

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
            ...(post.cover ? { image: `https://valuebasedbidding.com${post.cover}` } : {}),
          }),
        }}
      />
    </BlogShell>
  );
}
