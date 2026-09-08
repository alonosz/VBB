import { describe, expect, it } from "vitest";
import {
  MAX_LABELS,
  OTHER_LABEL,
  SORT_MIN_FILL,
  applySortedColumn,
  removeSortedColumn,
  sanitizeSortAnswer,
  scrubText,
  sortableColumns,
  sortedHeader,
  textsOf,
} from "./sort";
import type { DetectedField } from "@/lib/mapping/detect";

describe("what leaves the browser", () => {
  it("removes an email address", () => {
    expect(scrubText("hi, reach me at dana.k@northridge.com about cover")).toBe("hi, reach me at about cover");
  });

  it("removes a phone number, however it is punctuated", () => {
    expect(scrubText("call me on +44 (0)20 7946 0958 today")).toBe("call me on today");
    expect(scrubText("call 555-123-4567")).toBe("call");
  });

  it("removes a policy or account number and a link", () => {
    expect(scrubText("policy 8839201 see https://example.com/x?y=1 thanks")).toBe("policy see thanks");
  });

  it("keeps the small numbers a bucket needs", () => {
    expect(scrubText("I need cover for 3 vans by Friday")).toBe("I need cover for 3 vans by Friday");
  });

  it("truncates a long message", () => {
    expect(scrubText("x".repeat(1000))).toHaveLength(300);
  });
});

describe("which columns are offered", () => {
  const messages = [
    "need cover for three vans", "just looking for a quote", "my roof leaks after the storm",
    "how much is life insurance", "selling my house next month", "want to switch from my current insurer",
    "renewal is due, any better price", "do you cover classic cars", "a quote for my daughter's first car",
    "commercial property in the city centre",
  ];
  const rows = Array.from({ length: 40 }, (_, i) => ({
    Message: messages[i % 10] + ` ${i}`,
    Product: i % 2 ? "Auto" : "Home",
    Email: `lead${i}@example.com`,
    Notes: i < 8 ? `note ${i}` : "",
  }));
  const fields = [{ key: "email", column: "Email" }] as DetectedField[];

  it("offers a free-text column the mapping has not claimed", () => {
    const offered = sortableColumns(Object.keys(rows[0]), rows, fields);
    expect(offered.map((c) => c.column)).toEqual(["Message"]);
    expect(offered[0].fill).toBe(1);
  });

  it("does not offer a category, an identifier, or a column few leads wrote in", () => {
    const offered = sortableColumns(Object.keys(rows[0]), rows, []);
    expect(offered.map((c) => c.column)).not.toContain("Product");
    expect(offered.map((c) => c.column)).not.toContain("Email");
    expect(offered.map((c) => c.column)).not.toContain("Notes");
    expect(SORT_MIN_FILL).toBeGreaterThan(8 / 40);
  });
});

describe("the labels as a column", () => {
  const file = {
    headers: ["Message", "Amount"],
    rows: [
      { Message: "three vans, call 07700900123", Amount: "1" },
      { Message: "just a rough idea", Amount: "2" },
      { Message: "", Amount: "3" },
    ],
  };

  it("sends each distinct scrubbed message once", () => {
    expect(textsOf(file.rows, "Message")).toEqual(["three vans, call", "just a rough idea"]);
  });

  it("adds a column keyed by the scrubbed text, blank where nothing was written or labelled", () => {
    const next = applySortedColumn(file, "Message", { "three vans, call": "Commercial" });
    expect(next.headers).toEqual(["Message", "Amount", sortedHeader("Message")]);
    expect(next.rows.map((r) => r[sortedHeader("Message")])).toEqual(["Commercial", "", ""]);
    // The original column is untouched.
    expect(next.rows[0].Message).toBe(file.rows[0].Message);
  });

  it("can be taken out again", () => {
    const next = removeSortedColumn(applySortedColumn(file, "Message", {}), sortedHeader("Message"));
    expect(next.headers).toEqual(["Message", "Amount"]);
    expect(Object.keys(next.rows[0])).toEqual(["Message", "Amount"]);
  });
});

describe("the model's answer", () => {
  it("keeps the proposed labels, capped, with Other always last", () => {
    const a = sanitizeSortAnswer(
      { labels: ["Commercial", "commercial", "Urgent", "Other", "Price shopping", "A", "B", "C", "D", "E", "F"], assignments: [] },
      3,
      null
    );
    expect(a.labels).toHaveLength(MAX_LABELS);
    expect(a.labels[a.labels.length - 1]).toBe(OTHER_LABEL);
    expect(a.labels.filter((l) => l.toLowerCase() === "commercial")).toHaveLength(1);
  });

  it("assigns only labels from the set, to texts that were sent", () => {
    const a = sanitizeSortAnswer(
      { assignments: [
        { index: 0, label: "urgent" },
        { index: 1, label: "Made up" },
        { index: 7, label: "Urgent" },
        { index: 2, label: "Other" },
      ] },
      3,
      ["Urgent", "Other"]
    );
    expect(a.labels).toEqual(["Urgent", "Other"]);
    expect(a.assignments).toEqual(["Urgent", null, "Other"]);
  });

  it("never proposes a new label once the set is fixed", () => {
    const a = sanitizeSortAnswer({ labels: ["Brand new"], assignments: [] }, 1, ["Urgent", "Other"]);
    expect(a.labels).toEqual(["Urgent", "Other"]);
  });

  it("is all nulls for garbage", () => {
    expect(sanitizeSortAnswer("nope", 2, ["Other"]).assignments).toEqual([null, null]);
  });
});
