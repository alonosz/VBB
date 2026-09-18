import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { midpointIndex, outline } from "./Markdown";

const six = ["Intro.", "## A", "a", "## B", "b", "## C", "c", "## D", "d", "## E", "e", "## F", "f"].join("\n\n");

describe("the mid-article aside", () => {
  it("lands before the middle section, never inside one", () => {
    const tokens = marked.lexer(six);
    const at = midpointIndex(tokens);
    expect(at).not.toBeNull();
    const t = tokens[at as number];
    expect(t.type).toBe("heading");
    expect((t as { text: string }).text).toBe("D");
  });

  it("stays out of a short piece", () => {
    expect(midpointIndex(marked.lexer("## One\n\ntext\n\n## Two\n\ntext"))).toBeNull();
  });

  it("uses the same sections the table of contents does", () => {
    expect(outline(six).map((h) => h.text)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });
});
