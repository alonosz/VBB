import { NextResponse } from "next/server";
import {
  detectSnippet,
  normalizeTarget,
  resolvesPublicly,
  FETCH_TIMEOUT_MS,
  MAX_HTML_BYTES,
  MAX_REDIRECTS,
} from "@/lib/snippet/verify";

/**
 * Fetches a page the user names and reports whether the snippet is on it.
 *
 * Every hop is re-validated, because a public URL can redirect to a private
 * one and a redirect chain is the usual way an SSRF fence gets walked around.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const target = normalizeTarget(raw);
  if (!target.ok) return fail(target.error);

  let current = target.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await resolvesPublicly(current.hostname))) {
      return fail("That address resolves to a private network, so we can't reach it.");
    }

    let response: Response;
    try {
      response = await fetch(current, {
        // Followed by hand so each hop goes back through the checks above.
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          // Identifying ourselves is the polite thing when fetching someone's site.
          "user-agent": "VBB-Engine-SnippetCheck/1.0 (+https://valuebasedbidding.com)",
          accept: "text/html,application/xhtml+xml",
        },
      });
    } catch {
      return fail(`We couldn't load ${current.hostname}. Check the address is public and the page loads in a browser.`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return fail("That page redirected without saying where to.");
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return fail("That page redirected somewhere we couldn't read.");
      }
      const revalidated = normalizeTarget(next.href);
      if (!revalidated.ok) return fail("That page redirects to an address we won't follow.");
      current = revalidated.url;
      continue;
    }

    if (!response.ok) {
      return fail(`That page returned ${response.status}. Check the address, or try your homepage.`);
    }

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) {
      return fail("That address doesn't return a web page. Point it at a page with your form on it.");
    }

    // Read with a cap rather than trusting content-length; a hostile or broken
    // server can stream forever.
    const html = await readCapped(response);
    const finding = detectSnippet(html);

    return NextResponse.json({
      ok: true,
      checkedUrl: current.href,
      ...finding,
    });
  }

  return fail("That address redirected too many times.");
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (size >= MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return out;
}
