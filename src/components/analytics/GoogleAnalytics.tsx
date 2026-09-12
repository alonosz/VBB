"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Site traffic, not product data.
 *
 * Google Analytics reports which pages get visited and how visitors moved
 * through the diagnostic funnel - it never sees anything from a CRM file. A
 * CRM row lives in the browser's own state and this script has no route to
 * it, the same wall that keeps the file itself off any server.
 *
 * Off by default. With no `NEXT_PUBLIC_GA_MEASUREMENT_ID` set, this renders
 * nothing and the site behaves exactly as it did before - the same pattern
 * every other optional integration in this product follows.
 */

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

export function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();

  // The loader script fires one pageview for the first load. Every navigation
  // after that is a client-side route change Next.js handles without a
  // fresh page request, so nothing tells Analytics it happened unless this
  // does - without it, a five-step flow would report as one page view.
  useEffect(() => {
    if (typeof window.gtag !== "function") return;
    window.gtag("config", measurementId, { page_path: pathname });
  }, [pathname, measurementId]);

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${measurementId}');
        `}
      </Script>
    </>
  );
}
