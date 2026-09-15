import type { MetadataRoute } from "next";
import { SITE } from "./sitemap";

/**
 * Crawlers are welcome on the public pages and nowhere else.
 *
 * The feed route serves a customer's lead values to Google Ads against a
 * token in the URL. It is not secret by obscurity - the token is the control -
 * but there is no version of a search engine indexing it that is useful to
 * anybody.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/v1/", "/admin", "/workspace", "/join", "/evaluation", "/feed-status"],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
