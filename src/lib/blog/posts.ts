import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The articles, as files in the repository.
 *
 * No CMS and no database. An article is a markdown file, its history is the
 * git history, and publishing is a deploy. That is the right weight for a
 * handful of posts written by the person who owns the repo, and it means the
 * blog cannot break in a way the rest of the site survives.
 *
 * The header is a few `key: value` lines ended by a `---`, which is enough
 * structure for what a post needs and avoids a parser for a format nobody is
 * going to stretch.
 */

export const BLOG_DIR = path.join(process.cwd(), "content", "blog");

export interface PostMeta {
  /** The filename without its extension. Also the URL. */
  slug: string;
  title: string;
  description: string;
  /** ISO date, as written in the header. */
  date: string;
  author: string;
}

export interface Post extends PostMeta {
  /** Everything after the header, still markdown. */
  body: string;
}

/** A header line is `key: value`; the first bare `---` ends the header. */
export function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const lines = raw.replace(/^﻿/, "").split(/\r?\n/);
  const meta: Record<string, string> = {};

  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") {
      i += 1;
      break;
    }
    // A colon inside the value is common in a title, so only the first splits.
    const at = line.indexOf(":");
    if (at === -1) {
      if (line.trim() === "") continue;
      break;
    }
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }

  return { meta, body: lines.slice(i).join("\n").trim() };
}

/**
 * A post that is missing a title, a date or a description is a mistake worth
 * failing the build over rather than publishing half-described. Every one of
 * them is load-bearing: two are what search engines read, and the date is
 * what the index sorts on.
 */
function toPost(slug: string, raw: string): Post {
  const { meta, body } = parseFrontMatter(raw);
  for (const key of ["title", "description", "date"]) {
    if (!meta[key]) throw new Error(`content/blog/${slug}.md is missing "${key}" in its header`);
  }
  return {
    slug,
    title: meta.title,
    description: meta.description,
    date: meta.date,
    author: meta.author ?? "Alon Oszmann",
    body,
  };
}

export async function listPosts(): Promise<PostMeta[]> {
  let files: string[];
  try {
    files = await readdir(BLOG_DIR);
  } catch {
    // No articles yet is not a failure; the index says so instead.
    return [];
  }

  const posts = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => {
        const slug = f.replace(/\.md$/, "");
        return toPost(slug, await readFile(path.join(BLOG_DIR, f), "utf8"));
      })
  );

  // Newest first, and stable on a tie so two posts dated the same day do not
  // swap places between builds.
  return posts
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)))
    .map((post) => ({
      slug: post.slug,
      title: post.title,
      description: post.description,
      date: post.date,
      author: post.author,
    }));
}

export async function readPost(slug: string): Promise<Post | null> {
  // The slug reaches this from the URL. Anything that is not a plain name
  // cannot be a post, and must not become a path.
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    return toPost(slug, await readFile(path.join(BLOG_DIR, `${slug}.md`), "utf8"));
  } catch {
    return null;
  }
}

/** For display. The header carries ISO because that is what sorts. */
export function formatPostDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
