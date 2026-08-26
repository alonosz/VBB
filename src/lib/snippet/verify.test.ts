import { describe, expect, it } from "vitest";
import { normalizeTarget, isPrivateAddress, isPrivateHostname, detectSnippet } from "./verify";

// ---------------------------------------------------------------------------
// The fence around a user-supplied URL
// ---------------------------------------------------------------------------

describe("normalizeTarget", () => {
  it("assumes https when someone types a bare domain", () => {
    const r = normalizeTarget("example.com/pricing");
    expect(r.ok && r.url.href).toBe("https://example.com/pricing");
  });

  it("keeps an explicit http address", () => {
    const r = normalizeTarget("http://example.com");
    expect(r.ok && r.url.protocol).toBe("http:");
  });

  it("refuses a protocol that isn't the web", () => {
    for (const bad of ["file:///etc/passwd", "ftp://example.com", "gopher://example.com"]) {
      expect(normalizeTarget(bad).ok).toBe(false);
    }
  });

  it("refuses credentials smuggled into the address", () => {
    // http://expected.com@attacker.internal/ reads as one host and fetches another.
    const r = normalizeTarget("http://user:pass@example.com");
    expect(r.ok).toBe(false);
  });

  it("refuses localhost and loopback", () => {
    for (const bad of ["localhost", "http://localhost:5432", "http://127.0.0.1", "http://[::1]"]) {
      expect(normalizeTarget(bad).ok).toBe(false);
    }
  });

  it("refuses the cloud metadata endpoint", () => {
    // The single most valuable target for an SSRF on any major cloud.
    expect(normalizeTarget("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });

  it("refuses private ranges", () => {
    for (const bad of ["http://10.0.0.1", "http://192.168.1.1", "http://172.16.0.1"]) {
      expect(normalizeTarget(bad).ok).toBe(false);
    }
  });

  it("refuses an internal hostname with no dot", () => {
    expect(normalizeTarget("http://intranet").ok).toBe(false);
    expect(normalizeTarget("http://db.internal").ok).toBe(false);
  });

  it("asks for an address rather than failing silently on empty input", () => {
    const r = normalizeTarget("  ");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Enter the address/);
  });

  it("allows a normal public site", () => {
    expect(normalizeTarget("https://valuebasedbidding.com").ok).toBe(true);
  });
});

describe("isPrivateAddress", () => {
  it("knows the private v4 ranges", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "172.20.0.1", "192.168.0.5", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it("lets public v4 through", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });

  it("knows the v6 equivalents, including mapped v4", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("treats a bracketed v6 host the same as a bare one", () => {
    expect(isPrivateHostname("[::1]")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

const page = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

describe("detectSnippet", () => {
  it("finds the hosted script", () => {
    const r = detectSnippet(page(`<form></form><script src="https://vbb-cyan.vercel.app/vbb.js"></script>`));
    expect(r.installed).toBe(true);
    expect(r.hosted).toBe(true);
    expect(r.scriptUrl).toBe("https://vbb-cyan.vercel.app/vbb.js");
  });

  it("finds it with a cache-busting query string", () => {
    const r = detectSnippet(page(`<script src="/vbb.js?v=2"></script>`));
    expect(r.installed).toBe(true);
  });

  it("copes with single quotes and no quotes", () => {
    expect(detectSnippet(page(`<script src='/vbb.js'></script>`)).installed).toBe(true);
    expect(detectSnippet(page(`<script src=/vbb.js></script>`)).installed).toBe(true);
  });

  it("finds a pasted inline copy", () => {
    const r = detectSnippet(page(`<script>window.vbbCapture={};</script>`));
    expect(r.installed).toBe(true);
    expect(r.inline).toBe(true);
    expect(r.hosted).toBe(false);
  });

  it("says so when the snippet is absent", () => {
    const r = detectSnippet(page(`<form></form><script src="/analytics.js"></script>`));
    expect(r.installed).toBe(false);
    expect(r.scriptUrl).toBeNull();
  });

  it("is not fooled by a different script that merely mentions the name", () => {
    const r = detectSnippet(page(`<script src="/vendor/notvbb.json"></script>`));
    expect(r.installed).toBe(false);
  });

  it("warns when the tag sits above a form", () => {
    const r = detectSnippet(page(`<script src="/vbb.js"></script><form></form>`));
    expect(r.installed).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/above a form/);
  });

  it("does not warn when it sits after the forms", () => {
    const r = detectSnippet(page(`<form></form><script src="/vbb.js"></script>`));
    expect(r.warnings).toEqual([]);
  });

  it("warns about loading over http", () => {
    const r = detectSnippet(page(`<form></form><script src="http://x.com/vbb.js"></script>`));
    expect(r.warnings.join(" ")).toMatch(/http/);
  });

  it("handles a page with no forms at all", () => {
    const r = detectSnippet(page(`<script src="/vbb.js"></script>`));
    expect(r.installed).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
