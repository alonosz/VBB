"use client";

import { useEffect, useState } from "react";

/**
 * Back to where they were standing.
 *
 * Someone who connected HubSpot from step 2 asked to import their deals, not
 * to read a page about their nightly sync. HubSpot's redirect has no idea
 * about that, and the OAuth state is signed and carries the workspace id
 * alone - where they came from is this browser's business, so it stays here.
 *
 * The flag is only read, never cleared: step 2 clears it when it picks the
 * import back up. Clearing it here would mean a refresh of this page silently
 * cancels the thing they asked for.
 */

const RESUME = "vbb.hubspot.resumeImport.v1";

export function ResumeAfterConnect() {
  // Read at first render rather than in the effect. Setting state inside an
  // effect triggers a second render pass for something already known before
  // the first one.
  const [returning] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(RESUME) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // replace, not push: the back button should not walk into a spent OAuth
    // callback URL.
    if (returning) window.location.replace("/diagnostic/upload");
  }, [returning]);

  if (!returning) return null;

  return (
    <p className="mt-3 text-[13.5px] text-[var(--muted)]">
      Taking you back to your deals…
    </p>
  );
}
