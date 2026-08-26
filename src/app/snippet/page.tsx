import { headers } from "next/headers";
import { SnippetInstaller } from "@/components/snippet/SnippetInstaller";

/**
 * The origin is resolved on the server so the script tag renders identically
 * on both sides. Reading window.location during render instead would produce a
 * different tag on the server than in the browser, which React reports as a
 * hydration mismatch — and would briefly show the wrong tag to copy.
 */
export default async function SnippetPage() {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return <SnippetInstaller origin={host ? `${proto}://${host}` : ""} />;
}
