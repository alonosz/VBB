import { describe, expect, it } from "vitest";
import {
  buildCohortValueCsv,
  buildLeadConversionCsv,
  formatConversionTime,
  normalizeEmail,
  sha256Hex,
  GOOGLE_ADS_COLUMNS,
} from "./googleAds";
import type { CohortValue } from "@/lib/analysis/types";

const COHORTS: CohortValue[] = [
  { key: "Webinar · corporate", source: "Webinar", domainType: "corporate", sampleSize: 42, closeRate: 0.41, medianWonAmount: 8300, expectedValue: 3403, collapsedToSource: false },
  { key: "Paid Social", source: "Paid Social", domainType: null, sampleSize: 128, closeRate: 0.11, medianWonAmount: 4300, expectedValue: 473, collapsedToSource: false },
  { key: "Cold Outbound", source: "Cold Outbound", domainType: null, sampleSize: 27, closeRate: 0, medianWonAmount: null, expectedValue: null, collapsedToSource: false },
];

describe("formatConversionTime", () => {
  it("emits Google's required format with an explicit offset", () => {
    const t = formatConversionTime(new Date("2026-03-04T09:07:05Z"));
    expect(t).toBe("2026-03-04 09:07:05+00:00");
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
    // Verifiable against any sha256 tool — guards against an encoding change.
    expect(await sha256Hex("alice@example.com")).toBe(
      "ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976"
    );
  });

  it("hashes the normalized form, so casing does not change the digest", async () => {
    const a = await sha256Hex(normalizeEmail("Alice@Example.com"));
    const b = await sha256Hex(normalizeEmail("alice@example.com"));
    expect(a).toBe(b);
  });
});

describe("buildCohortValueCsv", () => {
  const csv = buildCohortValueCsv({
    cohorts: COHORTS,
    conversionName: "VBB Lead Value",
    currencyCode: "USD",
    conversionTime: new Date("2026-08-24T12:00:00Z"),
  });
  const lines = csv.trim().split("\n");

  it("leads with Google's exact column names in order", () => {
    const header = lines[0].split(",");
    expect(header.slice(0, 5)).toEqual([...GOOGLE_ADS_COLUMNS]);
  });

  it("writes one row per priced cohort", () => {
    expect(lines).toHaveLength(3); // header + 2 priced cohorts
  });

  it("omits a cohort with no expected value rather than exporting zero", () => {
    // Sending 0 tells Smart Bidding the lead was worthless, which is a
    // different claim from "we don't know yet".
    expect(csv).not.toMatch(/Cold Outbound/);
  });

  it("formats values to two decimals with the given currency", () => {
    expect(lines[1]).toMatch(/3403\.00/);
    expect(lines[1]).toMatch(/USD/);
  });

  it("carries the reference columns so the file is readable while filled in", () => {
    expect(lines[0]).toMatch(/Segment \(reference\)/);
    expect(lines[1]).toMatch(/Webinar/);
  });
});

describe("buildLeadConversionCsv", () => {
  const base = { conversionName: "VBB Lead Value", currencyCode: "USD" };

  it("exports click-ID rows and skips leads without one", async () => {
    const r = await buildLeadConversionCsv(
      [
        { clickId: "Cj0abc", email: null, createdAt: new Date("2026-05-01T00:00:00Z"), value: 1200 },
        { clickId: null, email: "x@y.com", createdAt: new Date("2026-05-01T00:00:00Z"), value: 900 },
      ],
      { ...base, identifier: "clickId" }
    );
    expect(r.included).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.skippedReason).toMatch(/click ID/);
    expect(r.csv).toMatch(/Cj0abc/);
  });

  it("hashes emails and never writes one in the clear", async () => {
    const r = await buildLeadConversionCsv(
      [{ clickId: null, email: "alice@example.com", createdAt: new Date("2026-05-01T00:00:00Z"), value: 500 }],
      { ...base, identifier: "email" }
    );
    expect(r.included).toBe(1);
    expect(r.csv).not.toMatch(/alice@example\.com/);
    expect(r.csv).toMatch(/ff8d9819fc0e12bf/);
    expect(r.csv.split("\n")[0]).toMatch(/^Email,/);
  });

  it("skips a lead with no create date rather than inventing a timestamp", async () => {
    const r = await buildLeadConversionCsv(
      [{ clickId: "Cj0abc", email: null, createdAt: null, value: 100 }],
      { ...base, identifier: "clickId" }
    );
    expect(r.included).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it("returns a header-only file with no reason when there is nothing to export", async () => {
    const r = await buildLeadConversionCsv([], { ...base, identifier: "clickId" });
    expect(r.included).toBe(0);
    expect(r.skippedReason).toBeNull();
    expect(r.csv.trim().split("\n")).toHaveLength(1);
  });
});
