import { describe, expect, it } from "vitest";
import {
  cleanStep,
  hashCaller,
  InMemoryLeadStore,
  isLeadSource,
  looksLikeEmail,
  MAX_PER_CALLER_PER_HOUR,
  normalizeEmail,
  RATE_WINDOW_MS,
} from "./leads";

const HOUR = 3_600_000;

describe("an address worth storing", () => {
  it("accepts the addresses people actually have", () => {
    for (const good of [
      "alon@bettersignals.co",
      "first.last@sub.domain.co.uk",
      "sales+ads@example.com",
      "a@b.io",
    ]) {
      expect(looksLikeEmail(good), good).toBe(true);
    }
  });

  it("catches the typo and the empty box, which is all it is for", () => {
    for (const bad of ["", "   ", "alon", "alon@", "@company.com", "alon@company", "a b@c.com"]) {
      expect(looksLikeEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses an address too long for the column", () => {
    expect(looksLikeEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });

  it("lowercases, and nothing else", () => {
    expect(normalizeEmail("  Alon@Company.COM ")).toBe("alon@company.com");
    // Gmail's dot and +tag rules are Gmail's. Treating a.b@ and ab@ as one
    // person is wrong at every provider that considers them different.
    expect(normalizeEmail("a.b+ads@fastmail.com")).toBe("a.b+ads@fastmail.com");
  });
});

describe("what may be stored alongside it", () => {
  it("keeps the step a label, not a notes field", () => {
    expect(cleanStep("report")).toBe("report");
    expect(cleanStep("  mapping  ")).toBe("mapping");
    expect(cleanStep("")).toBeNull();
    expect(cleanStep(undefined)).toBeNull();
    expect(cleanStep(42)).toBeNull();
    expect(cleanStep("x".repeat(200))).toHaveLength(40);
  });

  it("only knows the three places a box exists", () => {
    expect(isLeadSource("landing")).toBe(true);
    expect(isLeadSource("report")).toBe(true);
    expect(isLeadSource("flow")).toBe(true);
    expect(isLeadSource("crm")).toBe(false);
    expect(isLeadSource(null)).toBe(false);
  });

  it("hashes the caller rather than keeping the address", async () => {
    const hash = await hashCaller("203.0.113.7", "landing");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.7");

    // Salted per source: the same person filling in two different boxes is
    // two callers, because that is not abuse.
    expect(await hashCaller("203.0.113.7", "report")).not.toBe(hash);
    expect(await hashCaller(null, "landing")).toBeNull();
  });
});

describe("recording one", () => {
  it("keeps one row per person however often they come back", async () => {
    const store = new InMemoryLeadStore();
    await store.record({ email: "a@b.co", source: "landing", furthestStep: "landing", ipHash: null });
    await store.record({ email: "a@b.co", source: "report", furthestStep: "report", ipHash: null });

    const all = await store.list();
    expect(all).toHaveLength(1);
    // The interesting fact is where they got to, so the later step wins.
    expect(all[0].furthestStep).toBe("report");
    expect(all[0].source).toBe("report");
  });

  it("keeps when they first told us, not when they last did", async () => {
    let now = new Date("2026-08-01T10:00:00Z");
    const store = new InMemoryLeadStore(() => now);

    await store.record({ email: "a@b.co", source: "landing", furthestStep: "landing", ipHash: null });
    now = new Date("2026-08-09T10:00:00Z");
    await store.record({ email: "a@b.co", source: "report", furthestStep: "report", ipHash: null });

    const [row] = await store.list();
    expect(row.createdAt.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    expect(row.updatedAt.toISOString()).toBe("2026-08-09T10:00:00.000Z");
  });

  it("keeps two people apart", async () => {
    const store = new InMemoryLeadStore();
    await store.record({ email: "a@b.co", source: "report", furthestStep: null, ipHash: null });
    await store.record({ email: "c@d.co", source: "report", furthestStep: null, ipHash: null });
    expect(await store.list()).toHaveLength(2);
  });
});

describe("the rate limit", () => {
  it("counts what one caller left inside the window", async () => {
    const store = new InMemoryLeadStore();
    const caller = await hashCaller("203.0.113.7", "landing");

    for (let i = 0; i < MAX_PER_CALLER_PER_HOUR; i++) {
      await store.record({
        email: `person${i}@b.co`,
        source: "landing",
        furthestStep: null,
        ipHash: caller,
      });
    }

    const since = new Date(Date.now() - RATE_WINDOW_MS);
    expect(await store.countSince(caller, since)).toBe(MAX_PER_CALLER_PER_HOUR);
  });

  it("forgets rows older than the window", async () => {
    let now = new Date("2026-08-01T10:00:00Z");
    const store = new InMemoryLeadStore(() => now);
    const caller = await hashCaller("203.0.113.7", "landing");

    await store.record({ email: "a@b.co", source: "landing", furthestStep: null, ipHash: caller });

    now = new Date(now.getTime() + 2 * HOUR);
    expect(await store.countSince(caller, new Date(now.getTime() - RATE_WINDOW_MS))).toBe(0);
  });

  it("counts one caller without counting another", async () => {
    const store = new InMemoryLeadStore();
    const mine = await hashCaller("203.0.113.7", "landing");
    const theirs = await hashCaller("198.51.100.4", "landing");

    await store.record({ email: "a@b.co", source: "landing", furthestStep: null, ipHash: mine });

    const since = new Date(Date.now() - RATE_WINDOW_MS);
    expect(await store.countSince(mine, since)).toBe(1);
    expect(await store.countSince(theirs, since)).toBe(0);
  });

  it("does not lock out a proxy that strips the header", async () => {
    const store = new InMemoryLeadStore();
    for (let i = 0; i < 20; i++) {
      await store.record({
        email: `person${i}@b.co`,
        source: "landing",
        furthestStep: null,
        ipHash: null,
      });
    }
    // No hash means no caller to count, so an unidentifiable visitor is never
    // refused on someone else's behalf.
    expect(await store.countSince(null, new Date(Date.now() - RATE_WINDOW_MS))).toBe(0);
  });
});
