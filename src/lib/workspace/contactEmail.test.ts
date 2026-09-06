import { describe, expect, it } from "vitest";
import { InMemoryWorkspaceRepository } from "./repository";

/*
 * A workspace minted silently has no name anyone typed. The address left at
 * the send step is how the operator tells it apart and how the advertiser
 * gets back in from another device.
 */
describe("the address on a self-serve workspace", () => {
  it("starts empty and takes the latest one left", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const w = await repo.create({ name: "Self-serve, 2026-09-06 23:00 UTC", keyHash: "h", keyPrefix: "vbb_ws_abc" });
    expect((await repo.findById(w.id))?.contactEmail).toBeNull();

    await repo.setContactEmail(w.id, "dana@example.com");
    expect((await repo.findById(w.id))?.contactEmail).toBe("dana@example.com");

    await repo.setContactEmail(w.id, "dana@work.example");
    expect((await repo.findById(w.id))?.contactEmail).toBe("dana@work.example");
  });

  it("is listed with the workspace, so the operator sees who it is", async () => {
    const repo = new InMemoryWorkspaceRepository();
    const w = await repo.create({ name: "Self-serve, 2026-09-06 23:00 UTC", keyHash: "h", keyPrefix: "vbb_ws_abc" });
    await repo.setContactEmail(w.id, "dana@example.com");
    expect((await repo.list()).map((x) => x.contactEmail)).toEqual(["dana@example.com"]);
  });
});
