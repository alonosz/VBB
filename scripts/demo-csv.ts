/**
 * A fake CRM export, for proving the Google Ads import end to end.
 *
 * Built on the demo generator the app already ships, with two changes, both
 * for the same reason: every lead carries a click ID and no email column
 * exists at all. That keeps the published feed click-IDs-only, which keeps
 * Google's wizard on the plain offline import - no enhanced conversions for
 * leads, no Google tag, no website.
 *
 * The click IDs are invented, so Google will collect the file and match none
 * of it. Collection is the thing being proven; matching needs real clicks from
 * a real campaign.
 *
 *   npx tsx scripts/demo-csv.ts out.csv [rows]
 */
import Papa from "papaparse";
import { writeFileSync } from "node:fs";
import { generateDemoDeals, demoDealsToCsvRows } from "../src/lib/fixtures/demoDataset";

const out = process.argv[2];
if (!out) throw new Error("Usage: tsx scripts/demo-csv.ts <output.csv> [rows]");
const count = Number(process.argv[3] ?? 400);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Shaped like a real gclid: a ~75 character opaque token. Detection keys off
 *  that shape rather than the column name, so a short stub would not map. */
function clickId(seed: number): string {
  let a = (seed * 2654435761) & 0x7fffffff;
  const next = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
  let token = "Cj0KCQiA";
  for (let i = 0; i < 66; i++) token += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return token + seed.toString(36);
}

const rows = demoDealsToCsvRows(
  generateDemoDeals({ count, now: new Date() }).map((deal, i) => ({
    ...deal,
    clickId: clickId(i + 1),
    email: null,
  }))
).map((row) => {
  // Both address columns are dropped rather than blanked. A blank column still
  // appears on the mapping screen and invites exactly the choice this file
  // exists to avoid.
  const rest: Record<string, string> = { ...row };
  delete rest.contact_email;
  delete rest.owner_email;
  return rest;
});

writeFileSync(out, Papa.unparse(rows));
console.log(`${rows.length} rows -> ${out}`);
console.log(Object.keys(rows[0]).join(", "));
