import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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

describe("parseKey accepting a passphrase", () => {
  it("accepts a password-manager password, because that is what gets used", () => {
    // "32 random bytes in base64" is not something a non-developer can produce
    // without a terminal. A generated password is, so it has to work.
    const generated = "T7wq-Kx2P-vN9dR-4Lm8Hs-Ztu6Yb-Qe3Xa";
    const key = parseKey(generated);
    expect(key?.length).toBe(32);
    expect(decryptSecret(encryptSecret(TOKEN, key!), key!)).toBe(TOKEN);
  });

  it("derives the same key from the same passphrase every time", () => {
    // Or every restart would lose every stored connection.
    const phrase = "correct-horse-battery-staple-9271-xj";
    expect(parseKey(phrase)!.equals(parseKey(phrase)!)).toBe(true);
    expect(parseKey(phrase)!.equals(parseKey(phrase + "!")!)).toBe(false);
  });

  it("refuses a short passphrase rather than padding it", () => {
    // It would encrypt just as convincingly and protect nothing.
    for (const weak of ["hunter2", "password123", "short-one", "a".repeat(23)]) {
      expect(parseKey(weak), weak).toBeNull();
    }
    expect(parseKey("a".repeat(24))?.length).toBe(32);
  });

  it("still prefers a real key over hashing it as a passphrase", () => {
    const raw = Buffer.alloc(32, 7);
    // A proper key is used as-is; hashing it would work but silently differ
    // from what the operator generated.
    expect(parseKey(raw.toString("base64"))?.equals(raw)).toBe(true);
    expect(parseKey(raw.toString("hex"))?.equals(raw)).toBe(true);
  });

  it("does not mistake a long passphrase for base64", () => {
    // Node's base64 decoder is lenient enough to turn ordinary text into 32
    // bytes by accident, which would use a different key than intended.
    const phrase = "ThisIsALongPassphraseWithNoPunctuation";
    const viaPassphrase = createHash("sha256").update(phrase, "utf8").digest();
    expect(parseKey(phrase)?.equals(viaPassphrase)).toBe(true);
  });
});

describe("parseKey", () => {
  it("accepts base64 and hex, because both get pasted into dashboards", () => {
    const raw = Buffer.alloc(32, 7);
    expect(parseKey(raw.toString("base64"))?.equals(raw)).toBe(true);
    expect(parseKey(raw.toString("hex"))?.equals(raw)).toBe(true);
    expect(parseKey(`  ${raw.toString("base64")}  `)?.equals(raw)).toBe(true);
  });

  it("refuses anything too short to be either a key or a passphrase", () => {
    expect(parseKey("too-short")).toBeNull();
    expect(parseKey(undefined)).toBeNull();
    expect(parseKey("   ")).toBeNull();
    // The placeholder names from the setup instructions are the likeliest
    // thing to end up in the field by mistake, and they are far too short.
    expect(parseKey("Value_A")).toBeNull();
    expect(parseKey("Value_B")).toBeNull();
    expect(parseKey("your-key-here")).toBeNull();
  });

  it("generates a key that parses back to 32 bytes", () => {
    expect(parseKey(generateKey())?.length).toBe(32);
  });
});
