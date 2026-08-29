import { describe, expect, it } from "vitest";
import {
  buildValueModelCsv,
  formatConversionTime,
  normalizeEmail,
  sha256Hex,
  GOOGLE_ADS_COLUMNS,
} from "./googleAds";
import type { ValuedLead } from "@/lib/analysis/valueModel";
import type { MappedDeal } from "@/lib/analysis/types";

const WHEN = new Date("2026-05-01T09:07:05Z");

function lead(p: {
  id: string;
  value: number;
  clickId?: string | null;
  email?: string | null;
  createdAt?: Date | null;
}): ValuedLead {
  const deal: MappedDeal = {
    id: p.id,
    createdAt: p.createdAt === undefined ? WHEN : p.createdAt,
    closedAt: null,
    outcome: "open",
    amount: null,
    stage: null,
    source: "Paid Search",
    email: p.email ?? null,
    clickId: p.clickId ?? null,
  };
  return {
    deal,
    steps: [],
    stackMultiplier: 1,
    boundedMultiplier: 1,
    wasBounded: false,
    rawValue: p.value,
    value: p.value,
    cappedFrom: null,
  };
}

const BASE = { conversionName: "VBB Lead Value", currencyCode: "USD" } as const;

describe("formatConversionTime", () => {
  it("emits Google's required format with an explicit offset", () => {
    expect(formatConversionTime(new Date("2026-03-04T09:07:05Z")))
      .toBe("2026-03-04 09:07:05+00:00");
  });

  it("zero-pads every component", () => {
    expect(formatConversionTime(new Date("2026-01-02T03:04:05Z")))
      .toBe("2026-01-02 03:04:05+00:00");
  });
});

describe("email hashing", () => {
  it("lowercases and trims before hashing, per Google's spec", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("produces the known SHA-256 digest", async () => {
    expect(await sha256Hex("alice@example.com")).toBe(
      "ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976"
    );
  });

  it("hashes the normalized form, so casing does not change the digest", async () => {
    expect(await sha256Hex(normalizeEmail("Alice@Example.com")))
      .toBe(await sha256Hex(normalizeEmail("alice@example.com")));
  });
});

describe("buildValueModelCsv", () => {
  it("uses Google's exact column names in order", async () => {
    const r = await buildValueModelCsv({
      leads: [lead({ id: "1", value: 1200, clickId: "Cj0abc" })],
      identifier: "clickId",
      ...BASE,
    });
    expect(r.csv.split(/\r?\n/)[0].split(",")).toEqual([...GOOGLE_ADS_COLUMNS]);
  });

  it("emits one row per lead carrying that lead's own value", async () => {
    const r = await buildValueModelCsv({
      leads: [
        lead({ id: "1", value: 6270.83, clickId: "Cj0aaa" }),
        lead({ id: "2", value: 118.4, clickId: "Cj0bbb" }),
      ],
      identifier: "clickId",
      ...BASE,
    });
    expect(r.included).toBe(2);
    // Two leads, two different values - the point of the whole product.
    expect(r.csv).toMatch(/6270\.83/);
    expect(r.csv).toMatch(/118\.40/);
  });

  it("skips a lead with no click ID and says how many", async () => {
    const r = await buildValueModelCsv({
      leads: [
        lead({ id: "1", value: 900, clickId: "Cj0abc" }),
        lead({ id: "2", value: 900, clickId: null, email: "x@y.com" }),
      ],
      identifier: "clickId",
      ...BASE,
    });
    expect(r.included).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.skippedReason).toMatch(/click ID/);
  });

  it("hashes emails and never writes one in the clear", async () => {
    const r = await buildValueModelCsv({
      leads: [lead({ id: "1", value: 500, email: "alice@example.com" })],
      identifier: "email",
      ...BASE,
    });
    expect(r.included).toBe(1);
    expect(r.csv).not.toMatch(/alice@example\.com/);
    expect(r.csv).toMatch(/ff8d9819fc0e12bf/);
    expect(r.csv.split(/\r?\n/)[0]).toMatch(/^Email,/);
  });

  it("skips a lead with no create date rather than inventing a timestamp", async () => {
    const r = await buildValueModelCsv({
      leads: [lead({ id: "1", value: 100, clickId: "Cj0abc", createdAt: null })],
      identifier: "clickId",
      ...BASE,
    });
    expect(r.included).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it("skips a zero-valued lead rather than telling Google it was worthless", async () => {
    const r = await buildValueModelCsv({
      leads: [lead({ id: "1", value: 0, clickId: "Cj0abc" })],
      identifier: "clickId",
      ...BASE,
    });
    expect(r.included).toBe(0);
    expect(r.csv).not.toMatch(/0\.00/);
  });

  it("returns a header-only file with no reason when there is nothing to export", async () => {
    const r = await buildValueModelCsv({ leads: [], identifier: "clickId", ...BASE });
    expect(r.included).toBe(0);
    expect(r.skippedReason).toBeNull();
    expect(r.csv.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("stamps the conversion time from the lead's create date, not today", async () => {
    const r = await buildValueModelCsv({
      leads: [lead({ id: "1", value: 500, clickId: "Cj0abc" })],
      identifier: "clickId",
      ...BASE,
    });
    // Day-0 values attach to when the lead arrived.
    expect(r.csv).toMatch(/2026-05-01 09:07:05\+00:00/);
  });
});
