import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/blog/posts";

/**
 * What we want found.
 *
 * The public pages and every article. Deliberately not the diagnostic flow:
 * those screens are meaningless without the state a visitor builds on the way
 * through, and a search result landing somebody on step four of five shows
 * them an empty screen.
 */

export const SITE = "https://valuebasedbidding.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await listPosts();

  return [
    { url: SITE, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/blog`, changeFrequency: "weekly", priority: 0.8 },
    ...posts.map((post) => ({
      url: `${SITE}/blog/${post.slug}`,
      lastModified: new Date(`${post.date}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${SITE}/privacy`, changeFrequency: "yearly" as const, priority: 0.3 },
    { url: `${SITE}/terms`, changeFrequency: "yearly" as const, priority: 0.3 },
  ];
}
