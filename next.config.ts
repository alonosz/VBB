import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  env: {
    // Vercel sets VERCEL_GIT_COMMIT_SHA at build time. Surfacing it lets the
    // running app state which commit it was built from, so "is this the
    // latest version?" is answerable by looking at the page.
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
};

export default nextConfig;
