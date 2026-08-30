import { describe, expect, it } from "vitest";
import { AdsClient } from "./client";
import { fakeAds, type FakeAdsOptions } from "./fakeAds";
import {
  adjustmentPayload,
  conversionPayload,
  describeOutcome,
  MAX_ROWS_PER_CALL,
  readPartialFailures,
  uploadAdjustments,
  uploadConversions,
} from "./upload";
import type { FeedRow } from "@/lib/feed/types";

const CUSTOMER = "5932227642";
const ACTION = `customers/${CUSTOMER}/conversionActions/98765`;
const CONVERSIONS = `customers/${CUSTOMER}:uploadClickConversions`;
const ADJUSTMENTS = `customers/${CUSTOMER}:uploadConversionAdjustments`;

const HASH_A = "a".repeat(64);

function row(over: Partial<FeedRow> = {}): FeedRow {
  return {
    hashedEmail: null,
    clickId: "Cj0KCQiAaaaaaaaa",
    conversionTime: new Date("2026-08-20T09:07:05Z"),
    value: 1234.5,
    currencyCode: "USD",
    modelId: "model-1",
    kind: "conversion",
    rowKey: "rowkey-1",
    ...over,
  };
}

function ads(responses: FakeAdsOptions["responses"] = {}) {
  const fake = fakeAds({ responses });
  return {
    fake,
    client: new AdsClient({
      credentials: fake.credentials,
      fetchImpl: fake.fetchImpl,
      origin: fake.origin,
    }),
  };
}

const opts = (client: AdsClient, rows: FeedRow[]) => ({
  client,
  customerId: CUSTOMER,
  conversionActionResourceName: ACTION,
  rows,
});

describe("one conversion in Google's shape", () => {
  it("carries the lead's own value and its arrival time, not today", () => {
    const p = conversionPayload(row(), ACTION);
    expect(p.conversionValue).toBe(1234.5);
    expect(p.currencyCode).toBe("USD");
    // Day-0: when the lead arrived. Google needs an explicit offset.
    expect(p.conversionDateTime).toBe("2026-08-20 09:07:05+00:00");
    expect(p.conversionAction).toBe(ACTION);
  });

  /*
   * Both identifiers, for the same reason the CSV carries both columns:
   * Google matches on the click ID and falls back to the email for the leads
   * whose click ID never survived.
   */
  it("sends the click ID and the hashed email together when the lead has both", () => {
    const p = conversionPayload(row({ hashedEmail: HASH_A }), ACTION);
    expect(p.gclid).toBe("Cj0KCQiAaaaaaaaa");
    expect(p.userIdentifiers).toEqual([{ hashedEmail: HASH_A }]);
  });

  it("omits the identifier the lead does not have, rather than sending an empty one", () => {
    const emailOnly = conversionPayload(row({ clickId: null, hashedEmail: HASH_A }), ACTION);
    expect(emailOnly).not.toHaveProperty("gclid");
    const clickOnly = conversionPayload(row(), ACTION);
    expect(clickOnly).not.toHaveProperty("userIdentifiers");
  });

  /*
   * The identity that stops a republish sending the same lead twice. It is the
   * same rowKey the feed's own deduplication uses.
   */
  it("carries our row identity, so Google can deduplicate a republish", () => {
    expect(conversionPayload(row(), ACTION).orderId).toBe("rowkey-1");
  });

  it("never carries an address in the clear", () => {
    const json = JSON.stringify(conversionPayload(row({ hashedEmail: HASH_A }), ACTION));
    expect(json).not.toMatch(/@/);
  });
});

describe("an adjustment", () => {
  it("restates the value against the conversion it belongs to", () => {
    const p = adjustmentPayload(row({ kind: "adjustment", value: 4000 }), ACTION);
    expect(p.adjustmentType).toBe("RESTATEMENT");
    expect(p.orderId).toBe("rowkey-1");
    expect(p.restatementValue).toEqual({ adjustedValue: 4000, currencyCode: "USD" });
  });
});

describe("uploading", () => {
  it("sends only conversions, never adjustments, to the conversions endpoint", async () => {
    const { fake, client } = ads({ [CONVERSIONS]: {} });
    await uploadConversions(
      opts(client, [row(), row({ kind: "adjustment", rowKey: "rowkey-2" })])
    );
    const body = fake.calls[0].body as { conversions: unknown[] };
    expect(body.conversions).toHaveLength(1);
  });

  it("sends only adjustments to the adjustments endpoint", async () => {
    const { fake, client } = ads({ [ADJUSTMENTS]: {} });
    await uploadAdjustments(
      opts(client, [row(), row({ kind: "adjustment", rowKey: "rowkey-2" })])
    );
    const body = fake.calls[0].body as { conversionAdjustments: unknown[] };
    expect(body.conversionAdjustments).toHaveLength(1);
  });

  /*
   * Without partialFailure one malformed row refuses the whole batch, and a
   * night's values are lost to a single bad lead.
   */
  it("always asks for partial failure, so one bad row does not lose the night", async () => {
    const { fake, client } = ads({ [CONVERSIONS]: {} });
    await uploadConversions(opts(client, [row()]));
    expect((fake.calls[0].body as { partialFailure: boolean }).partialFailure).toBe(true);
    expect((fake.calls[0].body as { validateOnly: boolean }).validateOnly).toBe(false);
  });

  it("calls nothing at all when there is nothing to send", async () => {
    const { fake, client } = ads({ [CONVERSIONS]: {} });
    expect(await uploadConversions(opts(client, []))).toEqual({ accepted: 0, failures: [] });
    expect(fake.calls).toHaveLength(0);
  });

  it("splits a batch larger than Google's cap", async () => {
    const { fake, client } = ads({ [CONVERSIONS]: {} });
    const rows = Array.from({ length: MAX_ROWS_PER_CALL + 5 }, (_, i) =>
      row({ rowKey: `rowkey-${i}` })
    );
    const outcome = await uploadConversions(opts(client, rows));
    expect(fake.calls).toHaveLength(2);
    expect((fake.calls[0].body as { conversions: unknown[] }).conversions).toHaveLength(
      MAX_ROWS_PER_CALL
    );
    expect((fake.calls[1].body as { conversions: unknown[] }).conversions).toHaveLength(5);
    expect(outcome.accepted).toBe(MAX_ROWS_PER_CALL + 5);
  });
});

describe("when Google refuses some rows", () => {
  const partial = {
    partialFailureError: {
      code: 3,
      message: "Some rows failed.",
      details: [
        {
          errors: [
            {
              errorCode: { conversionUploadError: "UNPARSEABLE_GCLID" },
              message: "The click ID could not be read.",
              location: { fieldPathElements: [{ fieldName: "conversions", index: 1 }] },
            },
          ],
        },
      ],
    },
  };

  /*
   * The whole reason for the API route. A feed reports a rejected row to
   * nobody, so an advertiser can publish a thousand conversions, have every
   * one refused, and see only that nothing happened.
   */
  it("counts the good rows and reports the bad ones with a reason", async () => {
    const { client } = ads({ [CONVERSIONS]: partial });
    const outcome = await uploadConversions(
      opts(client, [row({ rowKey: "good" }), row({ rowKey: "bad" }), row({ rowKey: "also-good" })])
    );
    expect(outcome.accepted).toBe(2);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0].message).toMatch(/click ID could not be read/);
    expect(outcome.failures[0].errorCode).toBe("UNPARSEABLE_GCLID");
  });

  /*
   * Google reports failures by index into the batch we sent, so mapping back
   * to a lead is ours. Attaching a reason to the wrong lead is worse than
   * reporting none.
   */
  it("attaches the failure to the row that actually caused it", async () => {
    const { client } = ads({ [CONVERSIONS]: partial });
    const outcome = await uploadConversions(
      opts(client, [row({ rowKey: "good" }), row({ rowKey: "bad" })])
    );
    expect(outcome.failures[0].rowKey).toBe("bad");
  });

  it("survives a failure that names no row", () => {
    const failures = readPartialFailures(
      { details: [{ errors: [{ message: "Something went wrong." }] }] },
      [row()]
    );
    expect(failures).toEqual([
      { rowKey: "", errorCode: null, message: "Something went wrong." },
    ]);
  });

  it("reports a refusal that came with no message at all", () => {
    const failures = readPartialFailures(
      { details: [{ errors: [{ location: { fieldPathElements: [{ fieldName: "conversions", index: 0 }] } }] }] },
      [row({ rowKey: "k" })]
    );
    expect(failures[0].message).toMatch(/without saying why/);
    expect(failures[0].rowKey).toBe("k");
  });
});

describe("what the advertiser is told", () => {
  /*
   * "Nothing to send" and "everything was refused" are different events, and
   * reporting them the same way is how a healthy run and a week of silent
   * breakage become indistinguishable.
   */
  it("does not report an empty run the same way as a failed one", () => {
    expect(describeOutcome({ accepted: 0, failures: [] }, "conversion")).toMatch(/No new/);
    expect(
      describeOutcome(
        { accepted: 0, failures: [{ rowKey: "k", errorCode: "X", message: "No such action." }] },
        "conversion"
      )
    ).toMatch(/refused all 1/);
  });

  it("names the first reason when some were refused", () => {
    const message = describeOutcome(
      { accepted: 9, failures: [{ rowKey: "k", errorCode: "X", message: "No such action." }] },
      "conversion"
    );
    expect(message).toMatch(/accepted 9 conversions/);
    expect(message).toMatch(/refused 1/);
    expect(message).toMatch(/No such action/);
  });

  it("says value update rather than conversion for an adjustment", () => {
    expect(describeOutcome({ accepted: 3, failures: [] }, "adjustment")).toMatch(/3 value updates/);
  });
});
