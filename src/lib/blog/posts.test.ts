import { describe, expect, it } from "vitest";
import { formatPostDate, initials, listPosts, parseFrontMatter, readingMinutes, readPost } from "./posts";

describe("the article header", () => {
  it("reads key and value up to the first ---", () => {
    const { meta, body } = parseFrontMatter(
      ["title: A title", "date: 2026-09-15", "---", "", "First paragraph."].join("\n")
    );
    expect(meta.title).toBe("A title");
    expect(meta.date).toBe("2026-09-15");
    expect(body).toBe("First paragraph.");
  });

  it("keeps a colon inside a title, which is where they mostly appear", () => {
    const { meta } = parseFrontMatter("title: Value-Based Bidding: How to Start\n---\nBody.");
    expect(meta.title).toBe("Value-Based Bidding: How to Start");
  });

  it("leaves the body's own markdown alone", () => {
    const { body } = parseFrontMatter("title: T\n---\n## A heading\n\n| a | b |\n| - | - |");
    expect(body).toContain("## A heading");
    expect(body).toContain("| a | b |");
  });
});

describe("reading a post", () => {
  /*
   * The slug arrives from the URL. A path that escapes the content directory
   * must be refused before it reaches the filesystem, not after.
   */
  it("refuses a slug that is not a plain name", async () => {
    for (const slug of ["../../etc/passwd", "a/b", "Upper", "with space", ".env"]) {
      expect(await readPost(slug)).toBeNull();
    }
  });

  it("returns null for a name that is fine but missing", async () => {
    expect(await readPost("no-such-article")).toBeNull();
  });

  it("reads the article that ships with the repo", async () => {
    const post = await readPost("value-based-bidding-for-lead-generation");
    expect(post).not.toBeNull();
    expect(post?.title).toMatch(/value-based bidding/i);
    expect(post?.body).toContain("## Cheap leads can be expensive customers");
  });
});

describe("the index", () => {
  it("lists posts newest first and carries no body", async () => {
    const posts = await listPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]).not.toHaveProperty("body");
    // A featured post is pinned ahead of the date order on purpose; the
    // rest must still run newest first.
    const dates = posts.filter((p) => !p.featured).map((p) => p.date);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it("gives every post the three things a search result needs", async () => {
    for (const post of await listPosts()) {
      expect(post.title.length).toBeGreaterThan(0);
      expect(post.description.length).toBeGreaterThan(0);
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("reading time", () => {
  it("never says zero, even for a note", () => {
    expect(readingMinutes("Short.")).toBe(1);
  });

  it("does not count a table's pipes or a link's brackets as words", () => {
    const prose = Array.from({ length: 440 }, () => "word").join(" ");
    const noisy = `${prose}\n\n| a | b |\n| - | - |\n[x](https://example.com)`;
    expect(readingMinutes(noisy)).toBe(2);
  });

  it("is carried on every listed post", async () => {
    for (const post of await listPosts()) expect(post.minutes).toBeGreaterThanOrEqual(1);
  });
});

describe("the byline mark", () => {
  it("takes the first letter of the first two names", () => {
    expect(initials("Alon Oszmann")).toBe("AO");
    expect(initials("Cher")).toBe("C");
    expect(initials("  three  part name ")).toBe("TP");
  });
});

describe("the displayed date", () => {
  it("reads as a date rather than as a timestamp", () => {
    expect(formatPostDate("2026-09-15")).toBe("15 September 2026");
  });

  it("hands back whatever it was given when that is not a date", () => {
    expect(formatPostDate("soon")).toBe("soon");
  });
});

describe("the featured post", () => {
  /*
   * Three articles published on one day used to be ordered alphabetically,
   * which decided the index's biggest slot by accident. The flag makes that
   * an editorial choice instead.
   */
  it("comes first whatever the dates say", async () => {
    const posts = await listPosts();
    const featured = posts.filter((p) => p.featured);
    expect(featured.length).toBeGreaterThan(0);
    expect(posts[0].featured).toBe(true);
  });

  it("leaves the rest in date order behind it", async () => {
    const rest = (await listPosts()).filter((p) => !p.featured).map((p) => p.date);
    expect([...rest].sort((a, b) => b.localeCompare(a))).toEqual(rest);
  });
});
