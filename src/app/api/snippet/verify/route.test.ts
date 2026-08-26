import { afterEach, describe, expect, it, vi } from "vitest";

// A public-looking hostname has to resolve somewhere public for the route to
// proceed; the fence itself is tested directly in verify.test.ts.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const { GET } = await import("./route");

const PAGE = `<!doctype html><html><body><form></form>
<script src="https://vbb-cyan.vercel.app/vbb.js" async></script></body></html>`;

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

const call = (url: string) =>
  GET(new Request(`https://vbb.test/api/snippet/verify?url=${encodeURIComponent(url)}`));

afterEach(() => vi.unstubAllGlobals());

describe("the verify route, driven end to end", () => {
  it("reports the snippet on a page that has it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(PAGE)));
    const body = await (await call("https://example.com/contact")).json();

    expect(body.ok).toBe(true);
    expect(body.installed).toBe(true);
    expect(body.hosted).toBe(true);
    expect(body.scriptUrl).toBe("https://vbb-cyan.vercel.app/vbb.js");
    expect(body.checkedUrl).toBe("https://example.com/contact");
    expect(body.warnings).toEqual([]);
  });

  it("reports its absence without calling it an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("<html><body><form></form></body></html>")));
    const res = await call("https://example.com");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.installed).toBe(false);
  });

  it("identifies itself when fetching someone else's site", async () => {
    const spy = vi.fn((...args: [unknown, RequestInit?]) => {
      void args;
      return Promise.resolve(htmlResponse(PAGE));
    });
    vi.stubGlobal("fetch", spy);
    await call("https://example.com");
    const init = spy.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["user-agent"]).toMatch(/VBB-Engine-SnippetCheck/);
    // Redirects are followed by hand so each hop is re-checked.
    expect(init.redirect).toBe("manual");
  });

  it("follows a redirect and reports the page it ended on", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: "https://www.example.com/contact" } })
      )
      .mockResolvedValueOnce(htmlResponse(PAGE));
    vi.stubGlobal("fetch", fetchMock);

    const body = await (await call("https://example.com/contact")).json();
    expect(body.ok).toBe(true);
    expect(body.checkedUrl).toBe("https://www.example.com/contact");
  });

  it("refuses a redirect that points into a private network", async () => {
    // The usual way an SSRF fence gets walked around: a public URL that
    // bounces to the metadata endpoint.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } })
      )
    );
    const res = await call("https://example.com");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/won't follow/);
  });

  it("gives up on a redirect loop rather than following forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.com/again" } }))
    );
    const res = await call("https://example.com");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too many times/);
  });

  it("says what a failing page returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect((await (await call("https://example.com")).json()).error).toMatch(/returned 404/);
  });

  it("refuses something that is not a web page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
    );
    expect((await (await call("https://example.com")).json()).error).toMatch(/doesn't return a web page/);
  });

  it("explains a site it could not load, rather than leaking the exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED 1.2.3.4:443"); }));
    const body = await (await call("https://example.com")).json();
    expect(body.error).toMatch(/couldn't load example\.com/);
    expect(body.error).not.toMatch(/ECONNREFUSED/);
  });

  it("stops reading a page that streams forever", async () => {
    // A hostile or broken server should not be able to exhaust our memory.
    const chunk = "<!-- " + "x".repeat(64_000) + " -->";
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        sent++;
        if (sent > 200) return controller.close();
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(stream, { status: 200, headers: { "content-type": "text/html" } })
    ));

    const res = await call("https://example.com");
    expect(res.status).toBe(200);
    expect(sent).toBeLessThan(200);
  });
});
