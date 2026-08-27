import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  generateKey,
  parseKey,
} from "./secrets";

const KEY = parseKey(generateKey())!;
const TOKEN = "crm-token-placeholder-not-a-real-credential";

describe("encrypting a CRM credential", () => {
  it("round-trips", () => {
    expect(decryptSecret(encryptSecret(TOKEN, KEY), KEY)).toBe(TOKEN);
  });

  it("never leaves the plaintext visible in the stored form", () => {
    const encoded = encryptSecret(TOKEN, KEY);
    expect(encoded).not.toContain(TOKEN);
    expect(encoded).not.toContain("crm-token-placeholder");
  });

  it("produces a different ciphertext every time, so a reused IV cannot happen", () => {
    // Reusing an IV under one key in GCM is catastrophic rather than untidy.
    const seen = new Set(Array.from({ length: 50 }, () => encryptSecret(TOKEN, KEY)));
    expect(seen.size).toBe(50);
    for (const encoded of seen) expect(decryptSecret(encoded, KEY)).toBe(TOKEN);
  });

  it("refuses a ciphertext someone edited, rather than yielding a different token", () => {
    const encoded = encryptSecret(TOKEN, KEY);
    const parts = encoded.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64url");
    expect(decryptSecret(parts.join("."), KEY)).toBeNull();
  });

  it("refuses a tampered authentication tag", () => {
    const parts = encryptSecret(TOKEN, KEY).split(".");
    parts[2] = Buffer.alloc(16).toString("base64url");
    expect(decryptSecret(parts.join("."), KEY)).toBeNull();
  });

  it("returns null under the wrong key, so a rotation reads as reconnect-needed", () => {
    const other = parseKey(generateKey())!;
    expect(decryptSecret(encryptSecret(TOKEN, KEY), other)).toBeNull();
  });

  it("returns null for anything malformed rather than throwing", () => {
    for (const junk of ["", "not-encrypted", "v1.a.b", "v2.a.b.c", "v1....", "v1.a.b.c"]) {
      expect(decryptSecret(junk, KEY), junk).toBeNull();
    }
  });
});

describe("parseKey", () => {
  it("accepts base64 and hex, because both get pasted into dashboards", () => {
    const raw = Buffer.alloc(32, 7);
    expect(parseKey(raw.toString("base64"))?.equals(raw)).toBe(true);
    expect(parseKey(raw.toString("hex"))?.equals(raw)).toBe(true);
    expect(parseKey(`  ${raw.toString("base64")}  `)?.equals(raw)).toBe(true);
  });

  it("refuses a key of the wrong length rather than padding it", () => {
    expect(parseKey("too-short")).toBeNull();
    expect(parseKey(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(parseKey(undefined)).toBeNull();
    expect(parseKey("   ")).toBeNull();
  });

  it("generates a key that parses back to 32 bytes", () => {
    expect(parseKey(generateKey())?.length).toBe(32);
  });
});
