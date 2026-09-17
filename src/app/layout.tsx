import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/context/AppStateContext";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";

/**
 * Instrument Sans for everything that is not a figure. Variable, 400 to 700,
 * so every weight the scale uses comes from one file. next/font self-hosts
 * it, preloads it, and sizes the fallback face to match, so the swap from
 * fallback to loaded face moves nothing.
 */
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Every figure in the product is mono with tabular numerals. globals.css has
 * always referenced `--font-jetbrains-mono`; nothing was ever loading it, so
 * every table of numbers had been silently falling back to the system
 * monospace.
 */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Without this, the canonical and Open Graph URLs a page declares stay
  // relative, and a crawler resolves them against whichever preview host it
  // happened to arrive on.
  metadataBase: new URL("https://valuebasedbidding.com"),
  // The home page's own headline in search results. Blog pages set their own.
  title: "Value-Based Bidding for Lead Generation · ValueBasedBidding.com",
  description:
    "Turn your CRM history into lead values Google Ads can bid on. Value-based bidding for lead generation, from your own close rates and deal sizes. No CRM data is stored.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  return (
    <html lang="en" className={`${instrumentSans.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {gaId && <GoogleAnalytics measurementId={gaId} />}
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
