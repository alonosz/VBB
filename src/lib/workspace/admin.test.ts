import { describe, expect, it } from "vitest";
import { adminKeyMatches, MIN_ADMIN_KEY_LENGTH } from "./admin";

const KEY = "a-long-enough-admin-password";

describe("the operator's password", () => {
  it("admits the right one", () => {
    expect(adminKeyMatches(KEY, KEY)).toBe(true);
    expect(adminKeyMatches(`  ${KEY}  `, KEY)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const wrong of [
      "", "wrong", `${KEY}x`, KEY.slice(0, -1), KEY.toUpperCase(),
      undefined, null, 42, {}, [KEY],
    ]) {
      expect(adminKeyMatches(wrong, KEY), String(wrong)).toBe(false);
    }
  });

  it("refuses a prefix of the right password", () => {
    // The comparison is length-checked first and then constant-time, so it
    // cannot be walked one character at a time.
    for (let i = 1; i < KEY.length; i++) {
      expect(adminKeyMatches(KEY.slice(0, i), KEY)).toBe(false);
    }
  });

  it("expects a password long enough that guessing is not a strategy", () => {
    expect(MIN_ADMIN_KEY_LENGTH).toBeGreaterThanOrEqual(16);
  });
});
