import Image from "next/image";
import type { PostMeta } from "@/lib/blog/posts";

/**
 * What a post looks like before you read it.
 *
 * A cover image when the post has one. When it does not, a bar motif in the
 * brand blue, the same shape the front page opens with, so an article without
 * artwork still looks like it belongs to this product rather than like a
 * placeholder waiting for one. The bars are seeded from the slug, so a post
 * keeps its shape between builds and no two posts share one.
 *
 * The parent sets the size. This fills whatever box it is given.
 */

/** FNV-1a, enough to turn a slug into a stable starting point. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and deterministic for a given seed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BARS = 18;

export function Motif({ seed, className = "" }: { seed: string; className?: string }) {
  const next = rng(hash(seed));
  const heights = Array.from({ length: BARS }, () => 22 + Math.floor(next() * 78));

  return (
    <div
      aria-hidden
      className={`relative overflow-hidden ${className}`}
      style={{
        background:
          "radial-gradient(120% 100% at 0% 0%, rgba(42, 71, 245, 0.24) 0%, rgba(42, 71, 245, 0) 55%), " +
          "linear-gradient(160deg, var(--navy-soft) 0%, var(--navy) 100%)",
      }}
    >
      <div className="absolute inset-x-6 bottom-6 top-[30%] flex items-end gap-[3px] sm:inset-x-8 sm:bottom-8">
        {heights.map((h, i) => (
          <div
            key={i}
            className="bar flex-1"
            style={{
              height: `${h}%`,
              background: "linear-gradient(180deg, var(--primary-on-navy) 0%, var(--primary) 100%)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function PostVisual({
  post,
  priority = false,
  sizes,
  className = "",
}: {
  post: Pick<PostMeta, "slug" | "cover" | "coverAlt">;
  /** True for the one image that is on screen before anything else. */
  priority?: boolean;
  /** How wide this renders, for the browser to pick a sensible file. */
  sizes: string;
  className?: string;
}) {
  if (!post.cover) return <Motif seed={post.slug} className={className} />;

  return (
    <div className={`relative overflow-hidden bg-[var(--surface-sunken)] ${className}`}>
      <Image
        src={post.cover}
        alt={post.coverAlt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    </div>
  );
}
