import { describe, expect, it } from "vitest";
import { InMemoryWorkspaceRepository } from "./repository";
import { cleanName, completeSignup, safeNext } from "./signup";

describe("signing up", () => {
  it("makes a workspace and puts the name and address on it", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const r = await completeSignup({ repo, presented: null, ip: "1.2.3.4", name: "Dana Klein", email: " Dana@Example.com " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mintedKey).toMatch(/^vbb_ws_/);
    expect(r.workspace.name).toBe("Dana Klein");
    expect(r.workspace.contactEmail).toBe("dana@example.com");
    const stored = await repo.findById(r.workspace.id);
    expect(stored?.name).toBe("Dana Klein");
    expect(stored?.contactEmail).toBe("dana@example.com");
  });

  it("names the workspace this browser already holds rather than making a second", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const first = await completeSignup({ repo, presented: null, ip: null, name: "Dana", email: "d@x.com" });
    if (!first.ok) throw new Error("setup");
    const again = await completeSignup({ repo, presented: first.mintedKey, ip: null, name: "Dana Klein", email: "dana@x.com" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.mintedKey).toBeNull();
    expect(again.workspace.id).toBe(first.workspace.id);
    expect((await repo.list()).length).toBe(1);
  });

  it("refuses a missing name or a bad address before touching anything", async () => {
    const repo = new InMemoryWorkspaceRepository();
    expect((await completeSignup({ repo, presented: null, ip: null, name: "", email: "d@x.com" })).ok).toBe(false);
    expect((await completeSignup({ repo, presented: null, ip: null, name: "Dana", email: "nope" })).ok).toBe(false);
    expect((await repo.list()).length).toBe(0);
  });

  it("refuses a dead key rather than replacing it", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const r = await completeSignup({ repo, presented: "vbb_ws_" + "x".repeat(40), ip: null, name: "Dana", email: "d@x.com" });
    expect(r.ok).toBe(false);
    expect((await repo.list()).length).toBe(0);
  });
});

describe("a name", () => {
  it("is words, trimmed and bounded", () => {
    expect(cleanName("  Dana   Klein ")).toBe("Dana Klein");
    expect(cleanName("D")).toBeNull();
    expect(cleanName("dana@x.com")).toBeNull();
    expect(cleanName("<b>x</b>")).toBeNull();
    expect(cleanName("a".repeat(200))?.length).toBe(80);
  });
});

describe("where to go next", () => {
  it("stays on this site", () => {
    expect(safeNext("/diagnostic/upload")).toBe("/diagnostic/upload");
    expect(safeNext("//evil.com")).toBe("/diagnostic");
    expect(safeNext("https://evil.com")).toBe("/diagnostic");
    expect(safeNext(null)).toBe("/diagnostic");
  });
});
