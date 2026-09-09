import { describe, expect, it } from "vitest";
import { attachContactEmail } from "./contact";
import type { WorkspaceRepository } from "./repository";

function repo() {
  const set: [string, string][] = [];
  const r = { setContactEmail: async (id: string, email: string) => { set.push([id, email]); } } as unknown as WorkspaceRepository;
  return { r, set };
}

describe("the address given at connect", () => {
  it("goes on the workspace, normalised", async () => {
    const { r, set } = repo();
    expect(await attachContactEmail(r, "ws-1", "  Dana.K@Example.com ")).toBe(true);
    expect(set).toEqual([["ws-1", "dana.k@example.com"]]);
  });

  it("is dropped, not stored, when it is not an address", async () => {
    const { r, set } = repo();
    expect(await attachContactEmail(r, "ws-1", "not an email")).toBe(false);
    expect(await attachContactEmail(r, "ws-1", 42)).toBe(false);
    expect(await attachContactEmail(r, "ws-1", undefined)).toBe(false);
    expect(set).toEqual([]);
  });
});
