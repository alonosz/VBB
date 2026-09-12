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
  title: "Value Bidding Model Builder",
  description:
    "Build a reusable, value-based bidding / lead-scoring model from your own conversion data - no data science required.",
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
