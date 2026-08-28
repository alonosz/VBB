"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { forgetWorkspaceKey, readWorkspaceKey, rememberWorkspaceKey } from "@/lib/workspace/clientKey";

/**
 * One customer, one page.
 *
 * Written for whoever is asked "is this customer working?" — which has about
 * eight parts, each of which used to live in a different table with no screen
 * reading any of them.
 *
 * What to do comes first and the detail comes second, because someone opening
 * this at nine in the morning needs the answer, not the evidence. The evidence
 * is underneath for when the answer is not enough.
 */

interface ActionItem {
  severity: "blocked" | "attention" | "info";
  title: string;
  action: string;
  developer?: boolean;
}

interface Overview {
  workspace: { name: string; keyPrefix: string; status: string; createdAt: string };
  feed: {
    tokenPrefix: string; identifier: "clickId" | "email"; currencyCode: string;
    status: string; rowsPublished: number; publishedAt: string | null;
    lastFetchedAt: string | null; fetchesLast24h: number;
  } | null;
  model: {
    modelId: string; fittedAt: string | null; fittedOn: number;
    currencyCode: string; factorCount: number; hasGate: boolean; gateStage: string | null;
  } | null;
  connection: {
    connected: boolean; scopes: string | null;
    lastSyncAt: string | null; lastSyncStatus: string | null; lastSyncError: string | null;
  };
  runs: {
    id: number; startedAt: string; status: string; dealsPulled: number;
    rowsPublished: number; newConversions: number; adjustments: number;
    recalibrationOnly: number; skipped: number; message: string | null;
  }[];
  actions: ActionItem[];
  working: boolean;
}


const TONE: Record<ActionItem["severity"], { border: string; bg: string; dot: string; label: string }> = {
  blocked:   { border: "var(--danger)", bg: "var(--danger-soft)", dot: "●", label: "Needs fixing" },
  attention: { border: "var(--warn)",   bg: "var(--warn-soft)", dot: "●", label: "Worth a look" },
  info:      { border: "var(--accent)", bg: "var(--accent-soft)", dot: "✓", label: "Working" },
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] py-2 last:border-0">
      <span className="text-[13px] text-[var(--muted)]">{label}</span>
      <span className="mono text-right text-[13px] font-semibold">
        {value}
        {hint && <span className="ml-2 font-normal text-[var(--muted)]">{hint}</span>}
      </span>
    </div>
  );
}

export function WorkspaceView() {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (workspaceKey: string, remember: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't load this workspace.");
        setOverview(null);
        // A key that stopped working must not keep being retried on every visit.
        if (remember) forgetWorkspaceKey();
        return;
      }
      setOverview(data.overview as Overview);
      // Kept so returning is one click. It is a bearer credential, so it lives
      // in the browser that was given it and never in a URL.
      if (remember) rememberWorkspaceKey(workspaceKey);
    } catch {
      setError("We couldn't load this workspace.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = readWorkspaceKey();
    if (!saved) return;

    // Deferred a tick so the state this sets lands outside the effect's
    // synchronous body — setting it inline is the cascading-render pattern.
    const id = setTimeout(() => {
      setKey(saved);
      void load(saved, false);
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  function signOut() {
    forgetWorkspaceKey();
    setOverview(null);
    setKey("");
  }

  if (!overview) {
    return (
      <div className="animate-page-in flex min-h-screen flex-col">
        <main className="mx-auto w-full max-w-lg flex-1 px-6 py-20">
          <p className="label mb-2">Your workspace</p>
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            How is your bidding data doing?
          </h1>
          <p className="mt-2 text-[15px] text-[var(--muted)]">
            Paste the workspace key you were given. It starts{" "}
            <span className="mono">vbb_ws_</span> — it is not the feed URL that
            goes to Google.
          </p>

          <div className="card mt-8 p-5">
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && key.trim() && void load(key, true)}
                placeholder="vbb_ws_…"
                className="input mono min-w-0 flex-1 text-[13px]"
                aria-label="Workspace key"
              />
              <button
                type="button"
                onClick={() => void load(key, true)}
                disabled={loading || !key.trim()}
                className="btn btn-primary shrink-0"
              >
                {loading ? "Opening…" : "Open"}
                {!loading && <ArrowIcon />}
              </button>
            </div>
            {error && (
              <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
                {error}
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  const { workspace, feed, model, connection, runs, actions } = overview;

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="label mb-1">Workspace</p>
            <h1 className="text-3xl font-bold tracking-tight text-balance">{workspace.name}</h1>
          </div>
          <button type="button" onClick={signOut} className="btn btn-ghost text-xs">
            Sign out
          </button>
        </div>

        {/* ---- what to do, before the evidence ---- */}
        <section className="mt-7 grid gap-3">
          {actions.map((item, i) => {
            const tone = TONE[item.severity];
            return (
              <div
                key={`${item.title}-${i}`}
                className="rounded-2xl border px-4 py-3.5"
                style={{ borderColor: tone.border, background: tone.bg }}
              >
                <p className="label" style={{ color: tone.border }}>
                  {tone.dot} {tone.label}
                  {item.developer && " · developer"}
                </p>
                <p className="mt-1 text-[14.5px] font-bold">{item.title}</p>
                <p className="mt-1 max-w-[70ch] text-[13.5px]">{item.action}</p>
              </div>
            );
          })}
        </section>

        {/* ---- the evidence ---- */}
        <section className="card mt-5 p-5">
          <p className="text-[14px] font-bold">Feed</p>
          {feed ? (
            <div className="mt-2">
              <Row label="Status" value={feed.status === "active" ? "Active" : "Revoked"} />
              <Row label="Key" value={`${feed.tokenPrefix}…`} />
              <Row label="Matches on" value={feed.identifier === "clickId" ? "Ad click ID" : "Hashed email"} />
              <Row label="Currency" value={feed.currencyCode} />
              <Row label="Rows published" value={feed.rowsPublished.toLocaleString()} />
              <Row label="Last published" value={when(feed.publishedAt)} hint={ago(feed.publishedAt)} />
              <Row label="Google last collected" value={when(feed.lastFetchedAt)} hint={ago(feed.lastFetchedAt)} />
            </div>
          ) : (
            <p className="mt-1 text-[13.5px] text-[var(--muted)]">Nothing published yet.</p>
          )}
        </section>

        <section className="card mt-4 p-5">
          <p className="text-[14px] font-bold">Model</p>
          {model ? (
            <div className="mt-2">
              <Row label="Version" value={model.modelId} />
              <Row label="Fitted" value={when(model.fittedAt)} hint={ago(model.fittedAt)} />
              <Row label="Fitted on" value={`${model.fittedOn.toLocaleString()} resolved deals`} />
              <Row label="Rules" value={`${model.factorCount}`} />
              <Row
                label="Early gate"
                value={model.hasGate ? (model.gateStage ?? "yes") : "none"}
                hint={model.hasGate ? "sharpens inside 7 days" : undefined}
              />
              <Row label="Currency" value={model.currencyCode} />
            </div>
          ) : (
            <p className="mt-1 text-[13.5px] text-[var(--muted)]">No model saved with this feed.</p>
          )}
        </section>

        <section className="card mt-4 p-5">
          <p className="text-[14px] font-bold">CRM connection</p>
          <div className="mt-2">
            <Row label="Connected" value={connection.connected ? "HubSpot" : "No"} />
            {connection.connected && (
              <>
                <Row
                  label="Authorised via"
                  value={connection.scopes === "private-app" ? "Private app token" : "OAuth"}
                />
                <Row label="Last sync" value={when(connection.lastSyncAt)} hint={ago(connection.lastSyncAt)} />
                <Row label="Result" value={connection.lastSyncStatus ?? "—"} />
              </>
            )}
          </div>
          {connection.lastSyncError && (
            <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[12.5px]">
              {connection.lastSyncError}
            </p>
          )}
        </section>

        <section className="card mt-4 p-5">
          <p className="text-[14px] font-bold">Recent nightly runs</p>
          {runs.length === 0 ? (
            <p className="mt-1 text-[13.5px] text-[var(--muted)]">
              None yet. The first runs overnight after a CRM is connected.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                    <th className="label pb-1.5 font-bold">When</th>
                    <th className="label pb-1.5 font-bold">Result</th>
                    <th className="label pb-1.5 text-right font-bold">Pulled</th>
                    <th className="label pb-1.5 text-right font-bold">Sent</th>
                    <th className="label pb-1.5 text-right font-bold">Adjusted</th>
                    <th className="label pb-1.5 text-right font-bold">Too late</th>
                    <th className="label pb-1.5 text-right font-bold">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="mono py-1.5 whitespace-nowrap">{when(r.startedAt)}</td>
                      <td className="mono py-1.5">
                        <span style={{ color: r.status === "ok" ? "var(--accent)" : "var(--danger)" }}>
                          {r.status}
                        </span>
                      </td>
                      <td className="mono py-1.5 text-right">{r.dealsPulled.toLocaleString()}</td>
                      <td className="mono py-1.5 text-right">{r.newConversions.toLocaleString()}</td>
                      <td className="mono py-1.5 text-right">{r.adjustments.toLocaleString()}</td>
                      <td className="mono py-1.5 text-right">{r.recalibrationOnly.toLocaleString()}</td>
                      <td className="mono py-1.5 text-right">{r.skipped.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 max-w-[70ch] text-[12px] text-[var(--muted)]">
                <span className="font-semibold">Too late</span> means the lead&apos;s
                value moved after Google&apos;s 7-day window, so nothing was sent —
                that outcome feeds the next refit instead.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
