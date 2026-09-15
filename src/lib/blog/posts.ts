import { existsSync } from "node:fs";
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

/** Where a post's cover image lives, if one has been dropped in. */
export const COVER_DIR = path.join(process.cwd(), "public", "blog");
const COVER_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export interface PostMeta {
  /** The filename without its extension. Also the URL. */
  slug: string;
  title: string;
  description: string;
  /** ISO date, as written in the header. */
  date: string;
  author: string;
  /** Guide, Checklist, Perspective: what kind of piece it is. Optional. */
  kind: string | null;
  /** Reading time, whole minutes, never below one. */
  minutes: number;
  /** Public path of the cover image, or null when the post has none yet. */
  cover: string | null;
  coverAlt: string;
  /** Pinned to the top of the index, ahead of the date order. */
  featured: boolean;
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
 * Words over a reading pace, rounded to the nearest minute. Markdown
 * punctuation is stripped first so a table's pipes and a link's brackets do
 * not count as words.
 */
export function readingMinutes(body: string): number {
  const words = body
    .replace(/[#*_>|`[\]()]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * A cover is found by convention, so publishing one is dropping a file in
 * public/blog named after the post. The header can still point somewhere
 * else with `cover:` when the convention does not fit.
 */
function findCover(slug: string): string | null {
  for (const ext of COVER_EXTENSIONS) {
    if (existsSync(path.join(COVER_DIR, `${slug}.${ext}`))) return `/blog/${slug}.${ext}`;
  }
  return null;
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
    kind: meta.kind ?? null,
    minutes: readingMinutes(body),
    cover: meta.cover ?? findCover(slug),
    coverAlt: meta.coverAlt ?? meta.title,
    featured: meta.featured === "true",
    body,
  };
}

function metaOf(post: Post): PostMeta {
  return {
    slug: post.slug,
    title: post.title,
    description: post.description,
    date: post.date,
    author: post.author,
    kind: post.kind,
    minutes: post.minutes,
    cover: post.cover,
    coverAlt: post.coverAlt,
    featured: post.featured,
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

  /*
   * Newest first, and stable on a tie so two posts dated the same day do not
   * swap places between builds.
   *
   * A post marked `featured: true` in its header comes first whatever its
   * date. The index gives its top slot to one article at a size the others do
   * not get, and which article deserves that is an editorial decision rather
   * than a consequence of when it was written. Without this, three pieces
   * published on one day are ordered alphabetically, which is nobody's
   * judgement about anything.
   */
  return posts
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date);
    })
    .map(metaOf);
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

/** "Alon Oszmann" becomes "AO", for the byline mark. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
