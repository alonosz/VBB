"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import Link from "next/link";
import { forgetWorkspaceKey, readWorkspaceKey, rememberWorkspaceKey } from "@/lib/workspace/clientKey";
import { LiveShell } from "@/components/shell/LiveShell";
import { Alert, Badge, DataRow, Empty, Metric, Section, StatusDot, type Tone } from "@/components/ui";
import { identifierLabel } from "@/lib/export/googleAds";
import type { FeedIdentifier } from "@/lib/feed/types";

/**
 * One customer, one page.
 *
 * Written for whoever is asked "is this customer working?" - which has about
 * eight parts, each of which used to live in a different table with no screen
 * reading any of them.
 *
 * What to do comes first and the detail comes second, because someone opening
 * this at nine in the morning needs the answer, not the evidence. The evidence
 * is underneath for when the answer is not enough.
 *
 * This is also the one screen that says the setup is over. It wears the live
 * shell - product navigation instead of a five-step progress bar - and every
 * problem it reports links back to the setup screen that owns the fix rather
 * than growing a page of its own.
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
    tokenPrefix: string; identifier: FeedIdentifier; currencyCode: string;
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


const TONE: Record<ActionItem["severity"], Tone> = {
  blocked: "bad",
  attention: "warn",
  info: "good",
};

const TONE_LABEL: Record<ActionItem["severity"], string> = {
  blocked: "Needs fixing",
  attention: "Worth a look",
  info: "Working",
};

function when(iso: string | null): string {
  if (!iso) return "-";
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

type FixKey = "none" | "publish" | "model" | "crm" | "feed";

const FIXES: Record<FixKey, { href: string; label: string } | null> = {
  none: null,
  publish: { href: "/diagnostic", label: "Run the diagnostic" },
  model: { href: "/diagnostic/report", label: "Open the model" },
  crm: { href: "/diagnostic/connect", label: "Connect a CRM" },
  feed: { href: "/feed-status", label: "Check the feed" },
};

/**
 * Which setup screen fixes this. Matched on what the engine already said
 * rather than on a new field, so `buildOverview()` stays the single owner of
 * what is wrong and this file only owns where you go about it.
 */
function fixFor(item: ActionItem, overview: Overview): FixKey {
  if (item.developer) return "none";
  if (!overview.feed || overview.feed.status === "revoked") return "publish";
  if (!overview.model) return "model";

  // Both halves, because the engine writes the cause in the title for some
  // items ("No CRM is connected") and in the remedy for others ("The last sync
  // did not complete." / "HubSpot returned 401…").
  const text = `${item.title} ${item.action}`;
  if (/currency/i.test(text)) return "publish";
  if (/crm|hubspot|credential|reconnect/i.test(text)) return "crm";
  if (/collect|fetch|data source/i.test(text)) return "feed";
  return "none";
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
    // synchronous body - setting it inline is the cascading-render pattern.
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
        <main className="page-narrow flex-1 py-20">
          <p className="label mb-2">Your workspace</p>
          <h1 className="h1">How is your bidding data doing?</h1>
          <p className="lede mt-2.5 max-w-[52ch]">
            Paste the workspace key you were given. It starts{" "}
            <span className="mono font-semibold text-[var(--foreground)]">vbb_ws_</span>{" "}
            - it is not the feed URL that goes to Google.
          </p>

          <div className="card mt-8 p-5 sm:p-6">
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
              <div className="mt-4">
                <Alert tone="bad" title="That key didn't open a workspace">
                  <p className="text-[13.5px]">{error}</p>
                </Alert>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  const { workspace, feed, model, connection, runs, actions } = overview;

  const health: Tone = overview.working
    ? "good"
    : actions.some((a) => a.severity === "blocked")
      ? "bad"
      : "warn";

  return (
    <LiveShell
      status={
        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-2 sm:flex">
            <StatusDot tone={health} />
            <span className="text-[12.5px] font-semibold text-[var(--muted-strong)]">
              {overview.working ? "Live" : health === "bad" ? "Blocked" : "Check this"}
            </span>
          </span>
          <button type="button" onClick={signOut} className="btn btn-ghost btn-sm">
            Sign out
          </button>
        </div>
      }
    >
      {/*
        The band answers the only question this page exists for, before any
        evidence. Navy when it is working, because that is the same emphasis
        surface the report uses for the moment that matters.
      */}
      <section
        className={
          overview.working
            ? "panel-navy p-6 sm:p-8"
            : "card p-6 sm:p-8 " +
              (health === "bad"
                ? "border-[var(--danger-line)] bg-[var(--danger-soft)]"
                : "border-[var(--warn-line)] bg-[var(--warn-soft)]")
        }
      >
        <p
          className="label"
          style={overview.working ? { color: "var(--on-navy-muted)" } : undefined}
        >
          {workspace.name}
        </p>
        <h1
          className="h1 mt-2.5 max-w-[22ch]"
          style={overview.working ? { color: "var(--on-navy)" } : undefined}
        >
          {overview.working
            ? "Your values are reaching Google."
            : health === "bad"
              ? "Values are not reaching Google."
              : "Running, with something worth a look."}
        </h1>

        <div className="mt-7 grid gap-6 sm:grid-cols-3">
          <Metric
            onNavy={overview.working}
            label="Rows in the feed"
            value={feed ? feed.rowsPublished.toLocaleString() : "-"}
            hint={feed ? `published ${ago(feed.publishedAt)}` : "nothing published yet"}
          />
          <Metric
            onNavy={overview.working}
            label="Google last collected"
            value={feed ? ago(feed.lastFetchedAt) : "-"}
            hint={
              feed
                ? `${feed.fetchesLast24h} ${feed.fetchesLast24h === 1 ? "fetch" : "fetches"} in 24h`
                : undefined
            }
          />
          <Metric
            onNavy={overview.working}
            label="Last nightly sync"
            value={connection.connected ? ago(connection.lastSyncAt) : "not connected"}
            hint={connection.connected ? (connection.lastSyncStatus ?? undefined) : "manual publishing only"}
          />
        </div>
      </section>

      {/* ---- what to do, before the evidence ---- */}
      {actions.length > 0 && (
        <section className="mt-6 grid gap-3">
          {actions.map((item, i) => (
            <Alert
              key={`${item.title}-${i}`}
              tone={TONE[item.severity]}
              title={
                <>
                  {TONE_LABEL[item.severity]}
                  {item.developer && (
                    <span className="ml-2 font-semibold text-[var(--muted)]">
                      · your developer
                    </span>
                  )}
                </>
              }
            >
              <p className="text-[14.5px] font-bold">{item.title}</p>
              <p className="mt-1 text-[13.5px] text-[var(--muted-strong)]">{item.action}</p>
              {(() => {
                const fix = item.severity === "info" ? null : FIXES[fixFor(item, overview)];
                return fix ? (
                  <Link href={fix.href} className="btn btn-secondary btn-sm mt-3">
                    {fix.label} <ArrowIcon />
                  </Link>
                ) : null;
              })()}
            </Alert>
          ))}
        </section>
      )}

      {/* ---- the evidence ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Section
          title="Feed"
          aside={
            feed ? (
              <Badge tone={feed.status === "active" ? "good" : "bad"}>
                {feed.status === "active" ? "Active" : "Revoked"}
              </Badge>
            ) : undefined
          }
        >
          {feed ? (
            <div>
              <DataRow label="Key" value={`${feed.tokenPrefix}…`} />
              <DataRow
                label="Matches on"
                value={identifierLabel(feed.identifier)}
              />
              <DataRow label="Currency" value={feed.currencyCode} />
              <DataRow label="Rows published" value={feed.rowsPublished.toLocaleString()} />
              <DataRow label="Last published" value={when(feed.publishedAt)} hint={ago(feed.publishedAt)} />
              <DataRow
                label="Google last collected"
                value={when(feed.lastFetchedAt)}
                hint={ago(feed.lastFetchedAt)}
              />
            </div>
          ) : (
            <Empty
              title="Nothing published yet"
              body="Run the diagnostic on a CRM export and publish a feed. Nothing reaches Google until that exists."
              action={
                <Link href="/diagnostic" className="btn btn-primary btn-sm">
                  Start the diagnostic <ArrowIcon />
                </Link>
              }
            />
          )}
        </Section>

        <Section
          title="Model"
          aside={model ? <Badge tone="neutral">{model.modelId}</Badge> : undefined}
        >
          {model ? (
            <div>
              <DataRow label="Fitted" value={when(model.fittedAt)} hint={ago(model.fittedAt)} />
              <DataRow
                label="Fitted on"
                value={`${model.fittedOn.toLocaleString()} resolved deals`}
              />
              <DataRow label="Rules" value={String(model.factorCount)} />
              <DataRow
                label="Early gate"
                value={model.hasGate ? (model.gateStage ?? "yes") : "none"}
                hint={model.hasGate ? "sharpens inside 7 days" : undefined}
              />
              <DataRow label="Currency" value={model.currencyCode} />
            </div>
          ) : (
            <Empty
              title="No model saved with this feed"
              body="The nightly sync cannot price anything without one. Re-publish from the diagnostic, which saves the model alongside the feed."
              action={
                <Link href="/diagnostic/report" className="btn btn-secondary btn-sm">
                  Go to the model <ArrowIcon />
                </Link>
              }
            />
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section
          title="CRM connection"
          aside={
            <Badge tone={connection.connected ? "good" : "neutral"}>
              {connection.connected ? "HubSpot" : "Not connected"}
            </Badge>
          }
        >
          {connection.connected ? (
            <div>
              <DataRow
                label="Authorised via"
                value={connection.scopes === "private-app" ? "Private app token" : "OAuth"}
              />
              <DataRow label="Last sync" value={when(connection.lastSyncAt)} hint={ago(connection.lastSyncAt)} />
              <DataRow label="Result" value={connection.lastSyncStatus ?? "-"} />
            </div>
          ) : (
            <p className="text-[13.5px] text-[var(--muted)]">
              The feed only updates when someone publishes by hand. Connecting HubSpot
              has it refresh itself nightly.
            </p>
          )}
          {connection.lastSyncError && (
            <p className="well mt-3 px-3 py-2 text-[12.5px] text-[var(--muted-strong)]">
              {connection.lastSyncError}
            </p>
          )}
        </Section>
      </div>

      {/* ---- activity: a section here, not a screen of its own ---- */}
      <div className="mt-4">
        <Section
          title="Recent nightly runs"
          hint="Too late means the lead's value moved after Google's 7-day window, so nothing was sent - that outcome feeds the next refit instead."
        >
          {runs.length === 0 ? (
            <Empty
              title="No runs yet"
              body="The first one runs overnight after a CRM is connected."
            />
          ) : (
            <div className="scroll-x">
              <table className="table min-w-[34rem]">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Result</th>
                    <th className="num">Pulled</th>
                    <th className="num">Sent</th>
                    <th className="num">Adjusted</th>
                    <th className="num">Too late</th>
                    <th className="num">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="mono whitespace-nowrap text-[12.5px]">{when(r.startedAt)}</td>
                      <td>
                        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                          <StatusDot tone={r.status === "ok" ? "good" : "bad"} />
                          {r.status}
                        </span>
                      </td>
                      <td className="num">{r.dealsPulled.toLocaleString()}</td>
                      <td className="num">{r.newConversions.toLocaleString()}</td>
                      <td className="num">{r.adjustments.toLocaleString()}</td>
                      <td className="num">{r.recalibrationOnly.toLocaleString()}</td>
                      <td className="num">{r.skipped.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </LiveShell>
  );
}
