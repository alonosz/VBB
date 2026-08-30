import { describe, expect, it } from "vitest";
import {
  buildFeedRows,
  identifiersFor,
  feedRowKey,
  ADJUSTMENT_MIN_CHANGE,
  ADJUSTMENT_WINDOW_DAYS,
} from "./publish";
import { buildFeedCsv } from "./csv";
import { InMemoryFeedRepository } from "./repository";
import { assertStorableRow, type FeedRow } from "./types";
import { generateFeedToken, hashToken, hashIp, TOKEN_PREFIX } from "./token";
import type { ValuedLead } from "@/lib/analysis/valueModel";
import type { MappedDeal } from "@/lib/analysis/types";

const NOW = new Date("2026-06-15T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function lead(p: {
  id: string;
  value: number;
  clickId?: string | null;
  email?: string | null;
  createdAt?: Date | null;
}): ValuedLead {
  const deal: MappedDeal = {
    id: p.id,
    createdAt: p.createdAt === undefined ? day(1) : p.createdAt,
    closedAt: null,
    outcome: "open",
    amount: null,
    stage: null,
    source: "Paid Search",
    email: p.email ?? null,
    clickId: p.clickId ?? null,
  };
  return {
    deal, steps: [], stackMultiplier: 1, boundedMultiplier: 1,
    wasBounded: false, rawValue: p.value, value: p.value, cappedFrom: null,
  };
}

const BASE = { modelId: "model-1", currencyCode: "USD", now: NOW } as const;
const publish = (leads: ValuedLead[], extra: Partial<Parameters<typeof buildFeedRows>[0]> = {}) =>
  buildFeedRows({ leads, identifier: "clickId", ...BASE, ...extra });

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

describe("feed tokens", () => {
  it("mints a prefixed, high-entropy token and stores only its hash", async () => {
    const a = await generateFeedToken();
    const b = await generateFeedToken();
    expect(a.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.token.length).toBeGreaterThan(TOKEN_PREFIX.length + 30);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("the stored prefix cannot be used to reconstruct the token", async () => {
    const { token, tokenPrefix } = await generateFeedToken();
    expect(token.startsWith(tokenPrefix)).toBe(true);
    expect(tokenPrefix.length).toBeLessThan(token.length / 2);
  });

  it("hashes a presented token to the same value, so a fetch can be authorized", async () => {
    const { token, tokenHash } = await generateFeedToken();
    expect(await hashToken(token)).toBe(tokenHash);
    expect(await hashToken(` ${token} `)).toBe(tokenHash);
  });

  it("never logs a raw IP", async () => {
    const hashed = await hashIp("203.0.113.7", "salt");
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113");
    expect(await hashIp(null, "salt")).toBeNull();
  });

  it("salts the IP hash, so the log is not a lookup table of addresses", async () => {
    expect(await hashIp("203.0.113.7", "a")).not.toBe(await hashIp("203.0.113.7", "b"));
  });
});

// ---------------------------------------------------------------------------
// What gets emitted
// ---------------------------------------------------------------------------

describe("first publish", () => {
  it("emits one conversion per lead", async () => {
    const r = await publish([
      lead({ id: "1", value: 1200, clickId: "Cj0aaaaaaaaa" }),
      lead({ id: "2", value: 340, clickId: "Cj0bbbbbbbbb" }),
    ]);
    expect(r.newConversions).toBe(2);
    expect(r.adjustments).toBe(0);
    expect(r.rows.every((x) => x.kind === "conversion")).toBe(true);
  });

  it("hashes emails and never carries an address", async () => {
    const r = await publish([lead({ id: "1", value: 500, email: "Alice@Example.com" })], {
      identifier: "email",
    });
    expect(r.rows[0].hashedEmail).toBe(
      "ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976"
    );
    expect(JSON.stringify(r.rows)).not.toMatch(/alice@example\.com/i);
  });

  it("stamps the conversion time from when the lead arrived, not now", async () => {
    const arrived = day(3);
    const r = await publish([lead({ id: "1", value: 900, clickId: "Cj0aaaaaaaaa", createdAt: arrived })]);
    expect(r.rows[0].conversionTime).toEqual(arrived);
  });

  it("skips a lead with no identifier and says why", async () => {
    const r = await publish([
      lead({ id: "1", value: 900, clickId: "Cj0aaaaaaaaa" }),
      lead({ id: "2", value: 900, clickId: null, email: "x@y.com" }),
    ]);
    expect(r.newConversions).toBe(1);
    expect(r.skipped[0].reason).toMatch(/click ID/);
    expect(r.skipped[0].count).toBe(1);
  });

  it("never emits a zero value", async () => {
    const r = await publish([lead({ id: "1", value: 0, clickId: "Cj0aaaaaaaaa" })]);
    expect(r.rows).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/no value/);
  });

  it("skips a lead with no create date rather than inventing one", async () => {
    const r = await publish([lead({ id: "1", value: 100, clickId: "Cj0aaaaaaaaa", createdAt: null })]);
    expect(r.rows).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/create date/);
  });

  it("gives one lead's conversion a stable key across publishes", async () => {
    const when = day(2);
    expect(await feedRowKey("Cj0aaaaaaaaa", when)).toBe(await feedRowKey("Cj0aaaaaaaaa", when));
    expect(await feedRowKey("Cj0aaaaaaaaa", when)).not.toBe(await feedRowKey("Cj0bbbbbbbbb", when));
  });
});

// ---------------------------------------------------------------------------
// Republishing - the 7-day window
// ---------------------------------------------------------------------------

describe("republishing", () => {
  async function sent(value: number, ageDays: number): Promise<FeedRow[]> {
    const r = await publish([
      lead({ id: "1", value, clickId: "Cj0aaaaaaaaa", createdAt: day(ageDays) }),
    ]);
    return r.rows;
  }

  it("sends nothing again for a lead whose value has not moved", async () => {
    const previous = await sent(1000, 1);
    const r = await publish([lead({ id: "1", value: 1000, clickId: "Cj0aaaaaaaaa", createdAt: day(1) })], {
      previous,
    });
    expect(r.rows).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  it("adjusts a big change on a conversion still inside Google's window", async () => {
    const previous = await sent(1000, 2);
    const r = await publish([lead({ id: "1", value: 2500, clickId: "Cj0aaaaaaaaa", createdAt: day(2) })], {
      previous,
    });
    expect(r.adjustments).toBe(1);
    expect(r.rows[0].kind).toBe("adjustment");
    expect(r.rows[0].value).toBe(2500);
    // Same conversion, so the same key - the adjustment attaches to it.
    expect(r.rows[0].rowKey).toBe(previous[0].rowKey);
  });

  it("refuses to adjust a change under the 20% threshold", async () => {
    const previous = await sent(1000, 1);
    const justUnder = 1000 * (1 + ADJUSTMENT_MIN_CHANGE);
    const r = await publish([lead({ id: "1", value: justUnder, clickId: "Cj0aaaaaaaaa", createdAt: day(1) })], {
      previous,
    });
    expect(r.rows).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  it("refuses to adjust a conversion Google will no longer accept one for", async () => {
    // The deal closed for triple, forty days after the click. Google drops it.
    const previous = await sent(1000, 40);
    const r = await publish([lead({ id: "1", value: 3000, clickId: "Cj0aaaaaaaaa", createdAt: day(40) })], {
      previous,
    });
    expect(r.rows).toEqual([]);
    expect(r.adjustments).toBe(0);
    expect(r.recalibrationOnly).toBe(1);
  });

  it("treats the boundary as Google does - day 7 is already too late", async () => {
    const previous = await sent(1000, ADJUSTMENT_WINDOW_DAYS);
    const r = await publish(
      [lead({ id: "1", value: 5000, clickId: "Cj0aaaaaaaaa", createdAt: day(ADJUSTMENT_WINDOW_DAYS) })],
      { previous }
    );
    expect(r.recalibrationOnly).toBe(1);
    expect(r.adjustments).toBe(0);
  });

  it("compares against the last value sent, not the original", async () => {
    const first = await sent(1000, 1);
    const second = await publish(
      [lead({ id: "1", value: 2000, clickId: "Cj0aaaaaaaaa", createdAt: day(1) })],
      { previous: first }
    );
    // Already told Google 2000; a move to 2100 is 5% and not worth a row.
    const third = await publish(
      [lead({ id: "1", value: 2100, clickId: "Cj0aaaaaaaaa", createdAt: day(1) })],
      { previous: [...first, ...second.rows] }
    );
    expect(third.rows).toEqual([]);
    expect(third.unchanged).toBe(1);
  });

  it("still emits a genuinely new lead alongside an unchanged one", async () => {
    const previous = await sent(1000, 1);
    const r = await publish(
      [
        lead({ id: "1", value: 1000, clickId: "Cj0aaaaaaaaa", createdAt: day(1) }),
        lead({ id: "2", value: 700, clickId: "Cj0ccccccccc" }),
      ],
      { previous }
    );
    expect(r.newConversions).toBe(1);
    expect(r.rows[0].clickId).toBe("Cj0ccccccccc");
  });
});

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------

describe("buildFeedCsv", () => {
  it("uses Google's exact click-ID columns in order", async () => {
    const { rows } = await publish([lead({ id: "1", value: 1200, clickId: "Cj0aaaaaaaaa" })]);
    const csv = buildFeedCsv(rows, "clickId", "VBB Lead Value");
    expect(csv.split(/\r?\n/)[0]).toBe(
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency"
    );
  });

  it("uses the email columns when the feed matches on email", async () => {
    const { rows } = await publish([lead({ id: "1", value: 1200, email: "a@b.com" })], {
      identifier: "email",
    });
    const csv = buildFeedCsv(rows, "email", "VBB Lead Value");
    expect(csv.split(/\r?\n/)[0]).toMatch(/^Email,/);
    expect(csv).not.toMatch(/a@b\.com/);
  });

  it("writes the conversion time with an explicit offset", async () => {
    const { rows } = await publish([
      lead({ id: "1", value: 1200, clickId: "Cj0aaaaaaaaa", createdAt: new Date("2026-05-01T09:07:05Z") }),
    ]);
    expect(buildFeedCsv(rows, "clickId", "VBB Lead Value")).toMatch(/2026-05-01 09:07:05\+00:00/);
  });

  it("orders rows oldest first, as an import expects", async () => {
    const { rows } = await publish([
      lead({ id: "1", value: 100, clickId: "Cj0aaaaaaaaa", createdAt: day(1) }),
      lead({ id: "2", value: 200, clickId: "Cj0bbbbbbbbb", createdAt: day(9) }),
    ]);
    const lines = buildFeedCsv(rows, "clickId", "VBB Lead Value").split(/\r?\n/);
    expect(lines[1]).toContain("Cj0bbbbbbbbb");
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe("assertStorableRow", () => {
  const ok: FeedRow = {
    hashedEmail: "f".repeat(64), clickId: null, conversionTime: NOW,
    value: 10, currencyCode: "USD", modelId: "m", kind: "conversion", rowKey: "k",
  };

  it("accepts a well-formed row", () => {
    expect(() => assertStorableRow(ok)).not.toThrow();
  });

  it("refuses an unhashed email address", () => {
    expect(() => assertStorableRow({ ...ok, hashedEmail: "alice@example.com" }))
      .toThrow(/SHA-256/);
  });

  it("refuses an email smuggled into the click ID", () => {
    expect(() => assertStorableRow({ ...ok, hashedEmail: null, clickId: "alice@example.com" }))
      .toThrow(/ad click token/);
  });

  it("refuses a row with no identifier", () => {
    expect(() => assertStorableRow({ ...ok, hashedEmail: null, clickId: null }))
      .toThrow(/hashed email or a click ID/);
  });

  it("refuses a zero value", () => {
    expect(() => assertStorableRow({ ...ok, value: 0 })).toThrow(/above zero/);
  });
});

describe("InMemoryFeedRepository", () => {
  const feed = {
    tokenHash: "a".repeat(64), tokenPrefix: "vbb_live_8f2a",
    modelId: "m1", currencyCode: "USD", identifier: "clickId" as const,
    clientId: "ws-1",
  };

  it("finds a feed by the hash of its token", async () => {
    const repo = new InMemoryFeedRepository();
    const created = await repo.createFeed(feed);
    expect((await repo.findByTokenHash("a".repeat(64)))!.id).toBe(created.id);
    expect(await repo.findByTokenHash("b".repeat(64))).toBeNull();
  });

  it("does not resend a conversion on republish", async () => {
    const repo = new InMemoryFeedRepository();
    const created = await repo.createFeed(feed);
    const { rows } = await publish([lead({ id: "1", value: 900, clickId: "Cj0aaaaaaaaa" })]);
    expect(await repo.addRows(created.id, rows)).toBe(1);
    expect(await repo.addRows(created.id, rows)).toBe(0);
    expect(await repo.rowsFor(created.id)).toHaveLength(1);
  });

  it("refuses a row the database would refuse", async () => {
    const repo = new InMemoryFeedRepository();
    const created = await repo.createFeed(feed);
    await expect(
      repo.addRows(created.id, [{
        hashedEmail: "alice@example.com", clickId: null, conversionTime: NOW,
        value: 1, currencyCode: "USD", modelId: "m", kind: "conversion", rowKey: "k",
      }])
    ).rejects.toThrow(/SHA-256/);
  });

  it("counts only fetches inside the window", async () => {
    let clock = new Date("2026-06-15T00:00:00Z");
    const repo = new InMemoryFeedRepository(() => clock);
    const created = await repo.createFeed(feed);
    await repo.logFetch(created.id, { status: 200, rowCount: 1, userAgent: null, ipHash: null });
    clock = new Date("2026-06-17T00:00:00Z");
    await repo.logFetch(created.id, { status: 200, rowCount: 1, userAgent: null, ipHash: null });
    const since = new Date(clock.getTime() - 86_400_000);
    expect(await repo.countFetchesSince(created.id, since)).toBe(1);
  });
});

describe("identifiersFor", () => {
  /*
   * The rule this replaced sent whichever column covered more leads and threw
   * the other away. On the file below that meant dropping the third lead for
   * no reason: Google takes both columns in one file.
   */
  it("sends both when the file has both, rather than picking a winner", () => {
    const c = identifiersFor([
      lead({ id: "1", value: 1, clickId: "Cj0aaaaaaaaa" }),
      lead({ id: "2", value: 1, clickId: "Cj0bbbbbbbbb" }),
      lead({ id: "3", value: 1, email: "a@b.com" }),
    ]);
    expect(c.identifier).toBe("both");
    expect(c).toMatchObject({ clicks: 2, emails: 1, total: 3 });
  });

  it("says clickId only when there is not a single email", () => {
    expect(identifiersFor([
      lead({ id: "1", value: 1, clickId: "Cj0aaaaaaaaa" }),
    ]).identifier).toBe("clickId");
  });

  it("says email only when there is not a single click ID", () => {
    expect(identifiersFor([
      lead({ id: "1", value: 1, email: "a@b.com" }),
      lead({ id: "2", value: 1, email: "c@d.com" }),
    ]).identifier).toBe("email");
  });

  it("counts a lead carrying both once in each column", () => {
    const c = identifiersFor([
      lead({ id: "1", value: 1, clickId: "Cj0aaaaaaaaa", email: "a@b.com" }),
    ]);
    expect(c).toMatchObject({ clicks: 1, emails: 1, neither: 0, total: 1, identifier: "both" });
  });

  /*
   * `clicks + emails` is not the number of leads covered - a lead with both is
   * in both counts - so who is left out has to be counted, not subtracted.
   */
  it("counts who carries neither rather than inferring it", () => {
    const c = identifiersFor([
      lead({ id: "1", value: 1, clickId: "Cj0aaaaaaaaa", email: "a@b.com" }),
      lead({ id: "2", value: 1 }),
      lead({ id: "3", value: 1, email: "c@d.com" }),
    ]);
    expect(c).toMatchObject({ clicks: 1, emails: 2, neither: 1, total: 3 });
  });
});

describe("a feed carrying both identifiers", () => {
  const both = (
    leads: ValuedLead[],
    extra: Partial<Parameters<typeof buildFeedRows>[0]> = {}
  ) => publish(leads, { identifier: "both", ...extra });

  it("puts both on the row when the lead has both", async () => {
    const r = await both([
      lead({ id: "1", value: 900, clickId: "Cj0aaaaaaaaa", email: "Alice@Example.com" }),
    ]);
    expect(r.rows[0].clickId).toBe("Cj0aaaaaaaaa");
    expect(r.rows[0].hashedEmail).toBe(
      "ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976"
    );
  });

  /*
   * The whole reason for this shape. Under the old one-column rule the second
   * lead here was dropped, silently, because the first one had a click ID.
   */
  it("keeps a lead that has only one of the two", async () => {
    const r = await both([
      lead({ id: "1", value: 900, clickId: "Cj0aaaaaaaaa" }),
      lead({ id: "2", value: 900, email: "b@c.com" }),
    ]);
    expect(r.newConversions).toBe(2);
    expect(r.rows[0].hashedEmail).toBeNull();
    expect(r.rows[1].clickId).toBeNull();
    expect(r.skipped).toEqual([]);
  });

  it("drops only a lead carrying neither, and says so", async () => {
    const r = await both([lead({ id: "1", value: 900 })]);
    expect(r.rows).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/no click ID and no email/);
  });

  it("keys a lead on its click ID, so a republish does not resend it", async () => {
    const l = lead({ id: "1", value: 900, clickId: "Cj0aaaaaaaaa", email: "a@b.com" });
    const first = await both([l]);
    const again = await both([l], { previous: first.rows });
    expect(again.rows).toEqual([]);
    expect(again.unchanged).toBe(1);
  });

  it("writes both columns, blank where the lead has only one", async () => {
    const { rows } = await both([
      lead({ id: "1", value: 100, clickId: "Cj0aaaaaaaaa", email: "a@b.com", createdAt: day(2) }),
      lead({ id: "2", value: 200, email: "b@c.com", createdAt: day(1) }),
    ]);
    const lines = buildFeedCsv(rows, "both", "VBB Lead Value").split(/\r?\n/);
    expect(lines[0]).toBe(
      "Google Click ID,Email,Conversion Name,Conversion Time,Conversion Value,Conversion Currency"
    );
    expect(lines[1].startsWith("Cj0aaaaaaaaa,")).toBe(true);
    // The click ID cell is empty, not missing: a short row shifts every value
    // after it into the wrong column, which Google reads rather than rejects.
    expect(lines[2].startsWith(",")).toBe(true);
    expect(lines[2].split(",")).toHaveLength(6);
    expect(lines.join("\n")).not.toMatch(/@/);
  });
});

// ---------------------------------------------------------------------------
// The gate - the only thing that moves a lead's value after it arrived
// ---------------------------------------------------------------------------

describe("the early gate", () => {
  const GATE = {
    available: true, stage: "Qualified", multiplier: 3,
    reachedCount: 60, notReachedCount: 60,
    closeRateReached: 0.6, closeRateNotReached: 0.2,
    medianWonReached: 10_000, withinWindowRate: 0.8,
    rawMultiplier: 3, wasBounded: false, unusableReason: null,
  };

  function leadAt(ageDays: number, gateDays: number | null, value = 1000): ValuedLead {
    const base = lead({ id: "1", value, clickId: "Cj0aaaaaaaaa", createdAt: day(ageDays) });
    if (gateDays !== null) base.deal.stageReachedAfterDays = { Qualified: gateDays };
    return base;
  }

  it("raises the value of a lead that reached the gate in time", async () => {
    const previous = (await publish([leadAt(2, null)])).rows;
    const r = await publish([leadAt(2, 1)], { previous, gate: GATE });
    expect(r.gateAdjustments).toBe(1);
    expect(r.adjustments).toBe(1);
    // 1000 x 3, sent as an adjustment to the conversion already reported.
    expect(r.rows[0].value).toBe(3000);
    expect(r.rows[0].kind).toBe("adjustment");
    expect(r.rows[0].rowKey).toBe(previous[0].rowKey);
  });

  it("prices a brand-new lead that already cleared the gate", async () => {
    const r = await publish([leadAt(1, 0.5)], { gate: GATE });
    expect(r.newConversions).toBe(1);
    expect(r.rows[0].value).toBe(3000);
    expect(r.rows[0].kind).toBe("conversion");
  });

  it("refuses to raise a lead that reached the gate too late", async () => {
    // The demo happened on day 12. Google discards an adjustment that late, so
    // sending one would claim a bid moved that did not.
    const previous = (await publish([leadAt(20, null)])).rows;
    const r = await publish([leadAt(20, 12)], { previous, gate: GATE });
    expect(r.rows).toEqual([]);
    expect(r.gateAdjustments).toBe(0);
    expect(r.gateTooLate).toBe(1);
  });

  it("counts a late gate as recalibration input, not a lost opportunity", async () => {
    const r = await publish([leadAt(30, 15)], { gate: GATE });
    // Still a new lead, so it is sent - at its day-0 value, ungated.
    expect(r.rows[0].value).toBe(1000);
    expect(r.gateTooLate).toBe(1);
  });

  it("leaves a lead that never reached the gate at its day-0 value", async () => {
    const r = await publish([leadAt(2, null)], { gate: GATE });
    expect(r.rows[0].value).toBe(1000);
    expect(r.gateTooLate).toBe(0);
  });

  it("ignores a gate the data refused to price", async () => {
    const unusable = { ...GATE, available: false, multiplier: 1.1 };
    const r = await publish([leadAt(2, 1)], { gate: unusable });
    expect(r.rows[0].value).toBe(1000);
  });

  it("does nothing when there is no gate at all", async () => {
    const r = await publish([leadAt(2, 1)], { gate: null });
    expect(r.rows[0].value).toBe(1000);
  });

  it("still respects the 20% floor - a weak gate move is not worth a row", async () => {
    const weak = { ...GATE, multiplier: 1.1 };
    const previous = (await publish([leadAt(2, null)])).rows;
    const r = await publish([leadAt(2, 1)], { previous, gate: weak });
    expect(r.rows).toEqual([]);
    expect(r.unchanged).toBe(1);
  });
});
