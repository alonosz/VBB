import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppStateProvider } from "@/context/AppStateContext";
import { GoogleAnalytics } from "@/components/analytics/GoogleAnalytics";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {gaId && <GoogleAnalytics measurementId={gaId} />}
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
