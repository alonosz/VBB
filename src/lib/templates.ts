import type { RuleBlock } from "./types";

function findColumn(headers: string[], hints: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

let uid = 0;
function id(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  build: (headers: string[]) => RuleBlock[];
}

export const TEMPLATES: Template[] = [
  {
    id: "basic-lead-quality",
    name: "Basic Lead Quality",
    description:
      "Scores leads on how far they progressed plus whether you have core contact details.",
    build: (headers) => [
      {
        id: id("blk"),
        label: "Outcome reached",
        weight: 50,
        enabled: true,
        rule: {
          type: "value_tier",
          column: findColumn(headers, ["outcome", "status", "stage", "result"]),
          tiers: [
            { value: "Closed Won", points: 100 },
            { value: "Qualified", points: 60 },
            { value: "Contacted", points: 30 },
            { value: "New", points: 10 },
          ],
          defaultPoints: 0,
        },
      },
      {
        id: id("blk"),
        label: "Has phone number",
        weight: 25,
        enabled: true,
        rule: {
          type: "boolean_flag",
          column: findColumn(headers, ["phone", "mobile", "tel"]),
          presentPoints: 100,
          absentPoints: 0,
        },
      },
      {
        id: id("blk"),
        label: "Has email address",
        weight: 25,
        enabled: true,
        rule: {
          type: "boolean_flag",
          column: findColumn(headers, ["email", "e-mail"]),
          presentPoints: 100,
          absentPoints: 0,
        },
      },
    ],
  },
  {
    id: "deal-size-speed",
    name: "Deal Size + Speed",
    description:
      "Weighs record value against how quickly it moved from first contact to outcome.",
    build: (headers) => [
      {
        id: id("blk"),
        label: "Record value",
        weight: 50,
        enabled: true,
        rule: {
          type: "numeric_bucket",
          column: findColumn(headers, ["value", "amount", "price", "size", "revenue"]),
          mode: "percentile",
          buckets: [
            { min: null, max: 0, points: 0 },
          ],
          percentileBucketCount: 4,
          percentileScores: [25, 50, 75, 100],
        },
      },
      {
        id: id("blk"),
        label: "Speed to conversion",
        weight: 50,
        enabled: true,
        rule: {
          type: "time_decay",
          startColumn: findColumn(headers, ["created", "inquiry", "lead date", "first contact"]),
          endColumn: findColumn(headers, ["converted", "closed", "outcome date", "won date"]),
          maxPoints: 100,
          halfLifeDays: 7,
        },
      },
    ],
  },
  {
    id: "engagement-score",
    name: "Engagement Score",
    description:
      "Combines contact info completeness, lead source quality, and activity volume.",
    build: (headers) => [
      {
        id: id("blk"),
        label: "Has phone number",
        weight: 20,
        enabled: true,
        rule: {
          type: "boolean_flag",
          column: findColumn(headers, ["phone", "mobile", "tel"]),
          presentPoints: 100,
          absentPoints: 0,
        },
      },
      {
        id: id("blk"),
        label: "Has email address",
        weight: 20,
        enabled: true,
        rule: {
          type: "boolean_flag",
          column: findColumn(headers, ["email", "e-mail"]),
          presentPoints: 100,
          absentPoints: 0,
        },
      },
      {
        id: id("blk"),
        label: "Source quality",
        weight: 30,
        enabled: true,
        rule: {
          type: "value_tier",
          column: findColumn(headers, ["source", "channel", "campaign"]),
          tiers: [
            { value: "Referral", points: 100 },
            { value: "Organic", points: 70 },
            { value: "Paid", points: 50 },
          ],
          defaultPoints: 20,
        },
      },
      {
        id: id("blk"),
        label: "Activity volume",
        weight: 30,
        enabled: true,
        rule: {
          type: "numeric_bucket",
          column: findColumn(headers, ["page views", "sessions", "interactions", "visits"]),
          mode: "percentile",
          buckets: [{ min: null, max: 0, points: 0 }],
          percentileBucketCount: 4,
          percentileScores: [20, 45, 70, 100],
        },
      },
    ],
  },
];
