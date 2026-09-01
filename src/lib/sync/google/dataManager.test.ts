import { describe, expect, it } from "vitest";
import {
  conversionActionId,
  destination,
  eventFor,
  eventTimestamp,
  ingestEventsRequest,
} from "./dataManager";
import type { FeedRow } from "@/lib/feed/types";

function row(over: Partial<FeedRow> = {}): FeedRow {
  return {
    kind: "conversion",
    hashedEmail: null,
    clickId: null,
    conversionTime: new Date("2026-04-01T13:05:00.000Z"),
    value: 1234.56,
    currencyCode: "USD",
    modelId: "m1",
    rowKey: "row-key-1",
    ...over,
  } as FeedRow;
}

describe("the destination", () => {
  /*
   * The old service took a resource name. This one takes the bare numeric id,
   * and sending the resource name fails the whole request under fast-fail.
   */
  it("takes the numeric conversion action id out of a resource name", () => {
    expect(conversionActionId("customers/5932227642/conversionActions/7742720579")).toBe(
      "7742720579"
    );
  });

  it("refuses anything that is not one", () => {
    expect(conversionActionId("customers/5932227642")).toBeNull();
    expect(conversionActionId("")).toBeNull();
  });

  it("names the account that owns the action, as Google Ads", () => {
    expect(destination({ operatingAccountId: "5932227642", conversionActionId: "7742720579" }))
      .toEqual({
        operatingAccount: { accountId: "5932227642", accountType: "GOOGLE_ADS" },
        productDestinationId: "7742720579",
      });
  });

  it("carries the manager account only when signing in through one", () => {
    const withLogin = destination({
      operatingAccountId: "5932227642",
      conversionActionId: "7742720579",
      loginAccountId: "9210915280",
    });
    expect(withLogin.loginAccount).toEqual({
      accountId: "9210915280",
      accountType: "GOOGLE_ADS",
    });
    expect(
      destination({ operatingAccountId: "1", conversionActionId: "2", loginAccountId: null })
    ).not.toHaveProperty("loginAccount");
  });
});

describe("one lead as an event", () => {
  /*
   * RFC 3339, not the Google Ads API's "2026-04-01 13:05:00+00:00". Similar
   * enough to look interchangeable, and under fast-fail one wrong one takes
   * the whole batch with it.
   */
  it("writes the timestamp in RFC 3339", () => {
    expect(eventTimestamp(new Date("2026-04-01T13:05:00.000Z"))).toBe(
      "2026-04-01T13:05:00.000Z"
    );
  });

  it("sends the value in currency units, not micros", () => {
    expect(eventFor(row({ value: 1234.56 })).conversionValue).toBe(1234.56);
  });

  it("keeps our per-conversion identity so a republish cannot double-count", () => {
    expect(eventFor(row()).transactionId).toBe("row-key-1");
  });

  it("carries both identifiers when the lead has both", () => {
    const e = eventFor(row({ clickId: "gclid-1", hashedEmail: "abc123" }));
    expect(e.adIdentifiers).toEqual({ gclid: "gclid-1" });
    expect(e.userData).toEqual({ userIdentifiers: [{ emailAddress: "abc123" }] });
  });

  it("omits an identifier the lead does not carry", () => {
    const clickOnly = eventFor(row({ clickId: "gclid-1" }));
    expect(clickOnly).not.toHaveProperty("userData");
    const emailOnly = eventFor(row({ hashedEmail: "abc123" }));
    expect(emailOnly).not.toHaveProperty("adIdentifiers");
  });
});

describe("the whole request", () => {
  it("declares the encoding, which is required and rejects the batch without it", () => {
    const body = ingestEventsRequest({
      operatingAccountId: "5932227642",
      conversionActionId: "7742720579",
      rows: [row(), row({ rowKey: "row-key-2" })],
    });
    expect(body.encoding).toBe("HEX");
    expect(body.destinations).toHaveLength(1);
    expect(body.events).toHaveLength(2);
  });

  it("can ask Google to check without recording", () => {
    const body = ingestEventsRequest({
      operatingAccountId: "1",
      conversionActionId: "2",
      rows: [row()],
      validateOnly: true,
    });
    expect(body.validateOnly).toBe(true);
  });

  it("leaves validateOnly out of a real send", () => {
    const body = ingestEventsRequest({
      operatingAccountId: "1",
      conversionActionId: "2",
      rows: [row()],
    });
    expect(body).not.toHaveProperty("validateOnly");
  });
});
