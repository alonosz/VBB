import { lookup } from "node:dns/promises";

/**
 * Checking that a client actually installed the snippet.
 *
 * This fetches a URL somebody typed into a form, which makes it a
 * server-side request forgery vector unless it is fenced in: a URL like
 * http://169.254.169.254/ or http://localhost:5432 would otherwise make our
 * server probe its own network on a stranger's behalf. Everything below the
 * validation is only reached by a public HTTP(S) address.
 */

export const MAX_HTML_BYTES = 2_000_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

export interface TargetError {
  ok: false;
  error: string;
}
export interface TargetOk {
  ok: true;
  url: URL;
}

/** Parses and fences a user-supplied address. */
export function normalizeTarget(raw: string): TargetOk | TargetError {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Enter the address of a page on your site." };

  let url: URL;
  try {
    // Someone typing "example.com" means https, not a relative path.
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: "That doesn't look like a web address." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http and https addresses can be checked." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Remove the username and password from the address." };
  }
  if (isPrivateHostname(url.hostname)) {
    return { ok: false, error: "That address points at a private network, so we can't reach it." };
  }
  return { ok: true, url };
}

/** Names that never belong to a public site. */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;
  // A bare name with no dot is a machine on the local network, not a website.
  if (!host.includes(".") && !host.includes(":")) return true;
  return isPrivateAddress(host);
}

/** Private, loopback, link-local and cloud-metadata address ranges. */
export function isPrivateAddress(address: string): boolean {
  const v4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // 169.254.169.254 is the cloud metadata endpoint on every major provider.
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (address.includes(":")) {
    const v6 = address.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    // Unique-local and link-local.
    if (/^f[cd]/.test(v6) || v6.startsWith("fe80")) return true;
    // ::ffff:10.0.0.1 style mapped addresses.
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Resolves the hostname and refuses if it lands anywhere private. A public
 * name can point at 127.0.0.1, so checking the string alone is not enough.
 */
export async function resolvesPublicly(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

export interface SnippetFinding {
  installed: boolean;
  /** The src we found, when we found one. */
  scriptUrl: string | null;
  /** Loaded from our domain rather than copied and pasted inline. */
  hosted: boolean;
  inline: boolean;
  /** True when the tag sits after the last form - it would fire too late. */
  warnings: string[];
}

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/**
 * Looks for the snippet in a page's HTML.
 *
 * Deliberately string-based rather than a DOM parse: we are reading somebody
 * else's markup, which may be malformed in ways a parser would silently
 * "correct" into a different answer.
 */
export function detectSnippet(html: string): SnippetFinding {
  const warnings: string[] = [];
  let scriptUrl: string | null = null;
  let hosted = false;
  let inline = false;

  const tags = html.match(SCRIPT_TAG) ?? [];
  for (const tag of tags) {
    const src = tag.match(SRC_ATTR);
    const value = src ? (src[1] ?? src[2] ?? src[3] ?? "") : "";
    if (value && /\/vbb\.js(\?|$)/i.test(value)) {
      scriptUrl = value;
      hosted = true;
      break;
    }
  }

  // A pasted copy is fine, and identifiable by what the script defines.
  if (!hosted && /window\.vbbCapture|vbb_gclid/.test(html)) {
    inline = true;
  }

  const installed = hosted || inline;

  if (installed) {
    const anchor = scriptUrl
      ? html.toLowerCase().lastIndexOf("vbb.js")
      : html.indexOf("vbbCapture");
    const lastForm = html.toLowerCase().lastIndexOf("<form");
    if (lastForm !== -1 && anchor !== -1 && anchor < lastForm) {
      // Not fatal - the MutationObserver still catches forms added later - but
      // a tag above the forms is a sign it was pasted into the wrong place.
      warnings.push(
        "The script tag appears above a form on this page. It still works, but placing it just before </body> is more reliable."
      );
    }
    if (hosted && scriptUrl && scriptUrl.startsWith("http://")) {
      warnings.push("The script is loaded over http. Use https so it isn't stripped or blocked.");
    }
  }

  return { installed, scriptUrl, hosted, inline, warnings };
}
