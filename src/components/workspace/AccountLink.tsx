"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { forgetEverything } from "@/lib/auth/signOut";
import { readContactEmail } from "@/lib/leads/contactEmail";

/**
 * "Log in" for a device that does not hold a workspace, "Sign out" for one
 * that does. Read as an external store so the server, which cannot know,
 * renders nothing and the browser fills in.
 *
 * Signed in means this browser holds the address that was given at signup.
 * The key alone, as an invite leaves it, has nowhere to sign out to that it
 * is not already in, so the link stays quiet until there is a name on it.
 */
const subscribe = () => () => {};

export function AccountLink({ className = "" }: { className?: string }) {
  const router = useRouter();
  // The server cannot know, so it renders nothing: a "Log in" that flips to
  // "Sign out" on hydration is a link a returning customer can click first.
  const email = useSyncExternalStore(subscribe, readContactEmail, () => undefined);
  if (email === undefined) return null;
  if (email === null) {
    return (
      <a href="/api/auth/google/start?next=%2Fworkspace" className={className}>
        Log in
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        forgetEverything();
        // The decoded rows live under the diagnostic routes, so leaving them
        // is what drops them; the refresh re-reads storage for the header.
        router.push("/");
        router.refresh();
      }}
      className={className}
      title={`Signed in as ${email}`}
    >
      Sign out
    </button>
  );
}
