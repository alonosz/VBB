/**
 * Which origin a feed URL should be built from.
 *
 * Not the one the browser happens to be on. Vercel gives every deployment its
 * own immutable URL — `vbb-7ckmpyb5m-scope.vercel.app` — and if the advertiser
 * published while looking at one of those, the link they hand Google is
 * pinned to a single build forever. Worse, those URLs often sit behind Vercel's
 * deployment protection, so Google is served a login page and reports only
 * that it could not read the file.
 *
 * The failure is silent, permanent, and impossible for an advertiser to
 * diagnose, so the origin is decided here rather than taken from the request.
 *
 * Order of preference:
 *   1. VBB_PUBLIC_ORIGIN — an explicit override, for a custom domain.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the stable production domain, which
 *      Vercel sets on every deployment including previews.
 *   3. The request origin, which is right in local development and is the only
 *      thing available off Vercel.
 */

/** Deployment-specific Vercel hosts: project-hash-scope.vercel.app. */
const VERCEL_DEPLOYMENT_HOST = /^[a-z0-9-]+-[a-z0-9]{8,}-[a-z0-9-]+\.vercel\.app$/i;

export interface OriginSource {
  requestOrigin: string;
  publicOrigin?: string | undefined;
  productionUrl?: string | undefined;
}

function normalize(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Vercel's env var is a bare host, so a scheme is added when one is missing.
  // The check is for a scheme *followed by a host*: "http://" alone must not
  // be treated as already-schemed, or trimming it produces "https://http",
  // which parses cleanly and is completely wrong.
  const hasScheme = /^https?:\/\/[^/]/i.test(trimmed);
  const withProtocol = hasScheme ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // A host with no dot is either a typo or a scheme fragment that survived
  // parsing. localhost is the one legitimate exception.
  const host = url.hostname;
  if (!host || (!host.includes(".") && host !== "localhost")) return null;

  // URL.origin never carries a trailing slash, so the caller can append a path
  // without doubling it.
  return url.origin;
}

export function feedOrigin(source: OriginSource): string {
  const explicit = source.publicOrigin ? normalize(source.publicOrigin) : null;
  if (explicit) return explicit;

  const production = source.productionUrl ? normalize(source.productionUrl) : null;
  if (production) return production;

  return normalize(source.requestOrigin) ?? source.requestOrigin;
}

export function feedOriginFromEnv(requestOrigin: string): string {
  return feedOrigin({
    requestOrigin,
    publicOrigin: process.env.VBB_PUBLIC_ORIGIN,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
}

/**
 * Whether the origin we ended up with is a per-deployment Vercel URL. When it
 * is, the advertiser is about to be handed a link that will rot, and saying so
 * on screen is cheaper than them finding out from Google weeks later.
 */
export function isDeploymentOrigin(origin: string): boolean {
  try {
    return VERCEL_DEPLOYMENT_HOST.test(new URL(origin).hostname);
  } catch {
    return false;
  }
}
