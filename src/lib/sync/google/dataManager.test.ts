import { describe, expect, it } from "vitest";
import {
  DATA_MANAGER_SCOPE,
  conversionActionId,
  ingestEvents,
  readIngestError,
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

describe("the fields Google requires and the old API never had", () => {
  /*
   * eventSource is listed as "no equivalent" in the field mappings, so nothing
   * in the previous implementation could have hinted at it - and it is
   * required for offline conversions. Under fast-fail, forgetting it is not
   * one lost row, it is every row.
   */
  it("declares the event source, without which the batch is rejected", () => {
    expect(eventFor(row()).eventSource).toBe("WEB");
  });

  it("uses the Data Manager scope, not the Ads API one", () => {
    expect(DATA_MANAGER_SCOPE).toBe("https://www.googleapis.com/auth/datamanager");
    expect(DATA_MANAGER_SCOPE).not.toContain("adwords");
  });
});

describe("sending, and being refused", () => {
  const opts = {
    operatingAccountId: "5932227642",
    conversionActionId: "7742720579",
    rows: [row()],
    accessToken: "token-1",
  };

  it("posts to the ingest endpoint with no developer token", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ requestId: "abc-123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await ingestEvents({ ...opts, fetchImpl });
    expect(out.requestId).toBe("abc-123");
    expect(seen!.url).toBe("https://datamanager.googleapis.com/v1/events:ingest");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-1");
    expect(headers).not.toHaveProperty("developer-token");
  });

  /*
   * The whole batch dies on one field, so the field is the only useful thing
   * to report. This is Google's own example error.
   */
  it("names the field and row Google refused on", () => {
    const said = readIngestError(400, {
      error: {
        message: "There was a problem with the request.",
        details: [
          {
            fieldViolations: [
              {
                field: "events.events[0].user_data.user_identifiers",
                description: "Email is not hex encoded.",
                reason: "INVALID_HEX_ENCODING",
              },
            ],
          },
        ],
      },
    });
    expect(said).toContain("events.events[0].user_data.user_identifiers");
    expect(said).toContain("Email is not hex encoded.");
    expect(said).toMatch(/entire request|whole batch/i);
  });

  it("falls back to Google's message when it names no field", () => {
    expect(readIngestError(403, { error: { message: "Permission denied." } })).toBe(
      "Permission denied."
    );
  });

  it("throws that message rather than a bare status", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: { details: [{ fieldViolations: [{ field: "events.events[0]", reason: "INVALID_SHA256_FORMAT" }] }] },
        }),
        { status: 400 }
      )) as unknown as typeof fetch;

    await expect(ingestEvents({ ...opts, fetchImpl })).rejects.toThrow(/INVALID_SHA256_FORMAT/);
  });
});
