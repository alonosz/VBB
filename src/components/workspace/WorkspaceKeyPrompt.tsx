"use client";

import { useState } from "react";
import { rememberWorkspaceKey } from "@/lib/workspace/clientKey";

/**
 * Asks for the workspace key at the point it is needed.
 *
 * Publishing is authorised by the workspace key, and a customer who opens the
 * diagnostic before their workspace page has none stored. Telling them the key
 * is required and leaving them there is a dead end; this lets them paste it
 * without losing the work they have just done.
 */
export function WorkspaceKeyPrompt({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState("");

  function save() {
    if (!key.trim()) return;
    rememberWorkspaceKey(key);
    setKey("");
    onSaved();
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--warn)]/40 bg-amber-50 px-4 py-3.5">
      <p className="text-[13.5px] font-semibold">Paste your workspace key to publish</p>
      <p className="mt-0.5 max-w-[66ch] text-[13px] text-[var(--muted)]">
        It starts <span className="mono">vbb_ws_</span> and was sent to you when
        your workspace was set up. This browser remembers it, so you only do
        this once.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="vbb_ws_…"
          className="input mono min-w-0 flex-1 text-[13px]"
          aria-label="Workspace key"
        />
        <button
          type="button"
          onClick={save}
          disabled={!key.trim()}
          className="btn btn-secondary shrink-0 text-[13px]"
        >
          Save and continue
        </button>
      </div>
    </div>
  );
}
