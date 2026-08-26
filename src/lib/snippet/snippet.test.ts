// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tests run against public/vbb.js itself — the exact file a client pastes into
 * their site. Testing a re-implementation would prove nothing about the thing
 * that ships.
 */
const SNIPPET = readFileSync(resolve(__dirname, "../../../public/vbb.js"), "utf8");

declare global {
  interface Window {
    vbbCapture?: { run: () => void; read: () => Record<string, string>; version: string };
    vbbSnippet?: { version: string; captured: Record<string, string> };
  }
}

const GCLID = "Cj0KCQiA1x2ABCDEFghijklmnop_qrstuvwxyz0123456789";

function load(search = "", html = "") {
  window.history.replaceState({}, "", "/" + search);
  document.body.innerHTML = html;
  new Function(SNIPPET)();
}

function clearStorage() {
  localStorage.clear();
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
}

beforeEach(() => {
  clearStorage();
  document.body.innerHTML = "";
  delete window.vbbCapture;
  delete window.vbbSnippet;
});

describe("capturing from the URL", () => {
  it("stores a gclid in both a cookie and localStorage", () => {
    load(`?gclid=${GCLID}`);
    expect(document.cookie).toContain("vbb_gclid");
    // Safari caps script-set cookies at 7 days, shorter than a B2B cycle, so
    // the localStorage copy is not redundant.
    expect(localStorage.getItem("vbb_gclid")).toContain(GCLID);
  });

  it("captures the iOS variants, which arrive instead of gclid", () => {
    load(`?gbraid=${GCLID}`);
    expect(window.vbbCapture!.read()).toEqual({ gbraid: GCLID });
    clearStorage();
    load(`?wbraid=${GCLID}`);
    expect(window.vbbCapture!.read()).toEqual({ wbraid: GCLID });
  });

  it("captures fbclid too", () => {
    load(`?fbclid=${GCLID}`);
    expect(window.vbbCapture!.read().fbclid).toBe(GCLID);
  });

  it("ignores a value that is not a click ID", () => {
    load("?gclid=<script>alert(1)</script>");
    expect(window.vbbCapture!.read()).toEqual({});
  });

  it("ignores a value too short to be a real token", () => {
    load("?gclid=abc");
    expect(window.vbbCapture!.read()).toEqual({});
  });

  it("survives a page with no query string at all", () => {
    load("");
    expect(window.vbbCapture!.read()).toEqual({});
  });

  it("lets a newer click overwrite an older one", () => {
    load(`?gclid=${GCLID}`);
    load(`?gclid=${GCLID}zzz`);
    expect(window.vbbCapture!.read().gclid).toBe(`${GCLID}zzz`);
  });

  it("remembers the ID on a later page with no query string", () => {
    load(`?gclid=${GCLID}`);
    load(""); // a later page, no query string
    expect(window.vbbCapture!.read().gclid).toBe(GCLID);
  });
});

describe("filling forms", () => {
  it("adds a hidden field to a form already on the page", () => {
    load(`?gclid=${GCLID}`, "<form><input name='email'></form>");
    const field = document.querySelector<HTMLInputElement>('form input[name="gclid"]')!;
    expect(field.type).toBe("hidden");
    expect(field.value).toBe(GCLID);
    expect(field.getAttribute("data-vbb")).toBe("1");
  });

  it("fills every form, not just the first", () => {
    load(`?gclid=${GCLID}`, "<form id='a'></form><form id='b'></form>");
    expect(document.querySelectorAll('input[name="gclid"]')).toHaveLength(2);
  });

  it("never touches a field the site already had", () => {
    // Someone else's gclid input is theirs, whatever is in it.
    load(`?gclid=${GCLID}`, "<form><input name='gclid' value='theirs'></form>");
    const fields = document.querySelectorAll<HTMLInputElement>('input[name="gclid"]');
    expect(fields).toHaveLength(1);
    expect(fields[0].value).toBe("theirs");
  });

  it("adds nothing when there is no click ID to add", () => {
    load("", "<form></form>");
    expect(document.querySelector('input[name="gclid"]')).toBeNull();
  });

  it("adds a field per captured identifier", () => {
    load(`?gclid=${GCLID}&fbclid=${GCLID}x`, "<form></form>");
    expect(document.querySelector<HTMLInputElement>('input[name="gclid"]')!.value).toBe(GCLID);
    expect(document.querySelector<HTMLInputElement>('input[name="fbclid"]')!.value).toBe(`${GCLID}x`);
  });
});

describe("forms that appear later", () => {
  it("fills a form injected after load — HubSpot, Typeform, Marketo", async () => {
    load(`?gclid=${GCLID}`);
    expect(document.querySelector('input[name="gclid"]')).toBeNull();

    const form = document.createElement("form");
    document.body.appendChild(form);
    await vi.waitFor(() => {
      expect(form.querySelector<HTMLInputElement>('input[name="gclid"]')!.value).toBe(GCLID);
    });
  });

  it("fills a form nested inside an injected wrapper", async () => {
    load(`?gclid=${GCLID}`);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = "<div><form><input name='email'></form></div>";
    document.body.appendChild(wrapper);
    await vi.waitFor(() => {
      expect(wrapper.querySelector('input[name="gclid"]')).not.toBeNull();
    });
  });
});

describe("what the verifier can see", () => {
  it("stamps the page so an outside check can confirm it is live", () => {
    load(`?gclid=${GCLID}`);
    expect(window.vbbSnippet!.version).toBe("1");
    expect(window.vbbSnippet!.captured.gclid).toBe(GCLID);
    expect(typeof window.vbbCapture!.run).toBe("function");
  });
});

describe("hostile environments", () => {
  it("does not throw when localStorage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked in private mode");
      },
    });
    expect(() => load(`?gclid=${GCLID}`)).not.toThrow();
    // The cookie still carries it.
    expect(document.cookie).toContain("vbb_gclid");
    if (original) Object.defineProperty(window, "localStorage", original);
  });

  it("does not throw when MutationObserver is missing", () => {
    const original = window.MutationObserver;
    // @ts-expect-error deliberately removing it
    delete window.MutationObserver;
    expect(() => load(`?gclid=${GCLID}`, "<form></form>")).not.toThrow();
    expect(document.querySelector('input[name="gclid"]')).not.toBeNull();
    window.MutationObserver = original;
  });
});
