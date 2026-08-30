"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { readWorkspaceKey, rememberWorkspaceKey } from "@/lib/workspace/clientKey";

/**
 * The second door, open.
 *
 * A CRM export is the easiest thing in this product for a person to get wrong,
 * and the three ways to ruin one produce a file that loads perfectly and
 * analyses to nothing: won deals only, too short a window, the default column
 * set. None of them raise an error. This route cannot make any of them: the
 * window is fixed at twelve months, every outcome comes across, and the
 * columns are chosen by us rather than by whoever clicked Export.
 *
 * It is one button, not two. "Connect" and "import" are the same intent from
 * the advertiser's side, and asking them to notice which state they are in is
 * asking them to understand our OAuth flow. So the button tries the import
 * first: already connected and it just works, not connected and it starts the
 * handshake, coming back here to finish the job it was asked to do.
 *
 * The CSV route beside it is untouched and stays that way. Most CRMs are not
 * HubSpot, a connection needs permission from whoever owns the CRM, and the
 * file is the only way in that touches no credential at all.
 */

/**
 * Set before leaving for HubSpot, read on the way back.
 *
 * The OAuth state parameter is signed and carries the workspace id, and
 * nothing else belongs in it. Where the person was standing when they started
 * is this browser's business, so it stays in this browser.
 */
const RESUME = "vbb.hubspot.resumeImport.v1";

export interface ImportedRows {
  headers: string[];
  rows: Record<string, string>[];
  dealCount: number;
  currencies: { code: string; count: number }[];
}

export function ConnectHubSpot({
  onImported,
  busy,
}: {
  onImported: (imported: ImportedRows) => void;
  /** The CSV path is working. Two imports at once would race for the flow. */
  busy: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "connecting" | "importing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const started = useRef(false);

  /*
   * Both of these are known before the first render, so they are read here
   * rather than set from an effect: setting state inside an effect costs a
   * second render pass and, worse, makes the key prompt flash into existence
   * after the page has settled.
   *
   * Read, not cleared. Clearing in a lazy initialiser is not safe under
   * StrictMode, which may run it twice, so the effect below does it.
   */
  const [resuming] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(RESUME) === "1";
    } catch {
      return false;
    }
  });
  const [needsKey, setNeedsKey] = useState(
    () => resuming && typeof window !== "undefined" && !readWorkspaceKey()
  );

  const beginOAuth = useCallback(async (workspaceKey: string) => {
    setPhase("connecting");
    try {
      const res = await fetch("/api/crm/hubspot/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't start the connection.");
        setNeedsKey(res.status === 401);
        setPhase("idle");
        return;
      }
      // Remember to finish the import when HubSpot sends them back.
      try {
        sessionStorage.setItem(RESUME, "1");
      } catch {
        // A private window costs them one extra click, not the connection.
      }
      window.location.href = data.authorizeUrl as string;
    } catch {
      setError("We couldn't start the connection.");
      setPhase("idle");
    }
  }, []);

  const importDeals = useCallback(
    async (workspaceKey: string) => {
      setError(null);
      setPhase("importing");
      try {
        const res = await fetch("/api/crm/hubspot/deals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceKey }),
        });
        const data = await res.json();

        // Not connected yet is not an error, it is the first half of what they
        // asked for. Start the handshake rather than reporting a problem.
        if (res.status === 409) {
          await beginOAuth(workspaceKey);
          return;
        }
        if (!res.ok || !data.ok) {
          setError(data.error ?? "We couldn't read your deals.");
          setNeedsKey(res.status === 401);
          setPhase("idle");
          return;
        }
        if (!data.dealCount) {
          setError(
            "That portal has no deals created in the last 12 months, so there is " +
              "nothing to fit a model on yet."
          );
          setPhase("idle");
          return;
        }

        onImported({
          headers: data.headers as string[],
          rows: data.rows as Record<string, string>[],
          dealCount: data.dealCount as number,
          currencies: (data.currencies ?? []) as { code: string; count: number }[],
        });
      } catch {
        setError("We couldn't reach HubSpot. Try again.");
        setPhase("idle");
      }
    },
    [beginOAuth, onImported]
  );

  // Coming back from HubSpot, finish what they clicked. Once: a failed import
  // must not send them round the loop again.
  useEffect(() => {
    if (!resuming || started.current) return;
    started.current = true;
    try {
      sessionStorage.removeItem(RESUME);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    // A missing key already put the prompt on screen; there is nothing to
    // resume until they paste one.
    const key = readWorkspaceKey();
    // Queued rather than called: the import sets state as its first act, and
    // doing that synchronously inside an effect makes React render twice
    // before the page has painted once.
    if (key) queueMicrotask(() => void importDeals(key));
  }, [resuming, importDeals]);

  function onClick() {
    const stored = readWorkspaceKey();
    const key = (keyInput.trim() || stored || "").trim();
    if (!key) {
      setNeedsKey(true);
      setError(null);
      return;
    }
    if (keyInput.trim()) rememberWorkspaceKey(keyInput.trim());
    void importDeals(key);
  }

  const working = phase !== "idle";
  const label =
    phase === "connecting"
      ? "Opening HubSpot…"
      : phase === "importing"
        ? "Reading your deals…"
        : "Connect HubSpot";

  return (
    <div className="well mt-4 p-5 sm:p-6">
      <p className="text-[15px] font-bold">Connect HubSpot instead</p>
      <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[var(--muted)]">
        No export to get right and no columns to map. We read twelve months of
        deals, won and lost, straight from your portal. Read-only: nothing in
        your CRM is changed, and no CRM record is stored on our side.
      </p>

      {needsKey && (
        <div className="mt-3">
          <label htmlFor="ws-key" className="label block">
            Your workspace key
          </label>
          <p className="mt-1 max-w-[58ch] text-[12.5px] text-[var(--muted)]">
            It starts <span className="mono">vbb_ws_</span> and was created when you
            opened your invite link. The CSV route above needs no key at all.
          </p>
          <input
            id="ws-key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="vbb_ws_…"
            className="input mono mt-2 w-full max-w-[26rem] text-[13px]"
          />
        </div>
      )}

      <button
        type="button"
        onClick={onClick}
        disabled={working || busy}
        className="btn btn-primary mt-3.5 text-[13.5px]"
      >
        {label}
        {!working && <ArrowIcon />}
      </button>

      {phase === "importing" && (
        <p className="mt-2.5 max-w-[58ch] text-[12.5px] text-[var(--muted)]">
          Twelve months of deals, with their contacts and companies. A large
          portal takes up to a minute.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2.5 max-w-[62ch] text-[13px] text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
