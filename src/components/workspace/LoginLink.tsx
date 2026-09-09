"use client";

import { useSyncExternalStore } from "react";
import { readContactEmail } from "@/lib/leads/contactEmail";

/**
 * "Log in", for somebody on a device that does not hold their workspace.
 * Hidden once this browser has one, because then there is nothing to log
 * in to that they are not already in. Read as an external store so the
 * server, which cannot know, renders nothing and the browser fills in.
 */
const subscribe = () => () => {};

export function LoginLink({ className = "" }: { className?: string }) {
  const signedIn = useSyncExternalStore(subscribe, () => !!readContactEmail(), () => true);
  if (signedIn) return null;
  return (
    <a href="/api/auth/google/start?next=%2Fworkspace" className={className}>
      Log in
    </a>
  );
}
