"use client";

import { useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * Whether Google is actually collecting the feed.
 *
 * Between pasting a URL into Google Ads and seeing conversions appear, the
 * advertiser is blind. "Nothing has happened yet" and "Google is failing to
 * read it" look identical from their side and need opposite responses, and the
 * platform reports neither back to us.
 *
 * We already log every fetch — counting them over 24 hours is how the rate
 * limiter works — so the answer was in the database the whole time and simply
 * was not being shown. This screen shows it.
 */

interface Status {
  tokenPrefix: string;
  publishedAt: string | null;
  rowsPublished: number;
  currencyCode: string;
  identifier: "clickId" | "email";
  modelId: string;
  fetches: { at: string; status: number; rowCount: number }[];
  lastSuccessAt: string | null;
  verdict: "never-fetched" | "collecting" | "failing";
  message: string;
}

const TONE: Record<Status["verdict"], { label: string; color: string; dot: string }> = {
  collecting: { label: "Collecting", color: "var(--accent)", dot: "●" },
  "never-fetched": { label: "Not yet collected", color: "var(--warn)", dot: "○" },
  failing: { label: "Failing", color: "var(--danger)", dot: "●" },
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FeedStatusChecker() {
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [crmToken, setCrmToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);

  async function check() {
    setChecking(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/feeds/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) setError(data.error ?? "We couldn't check that feed.");
      else setStatus(data.status as Status);
    } catch {
      setError("We couldn't check that feed.");
    } finally {
      setChecking(false);
    }
  }

  /**
   * Starting a HubSpot connection.
   *
   * POSTed rather than linked, so the feed key never travels in a URL. The
   * server hands back the authorize link and the browser follows it.
   */
  async function connectHubSpot() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/hubspot/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't start the connection.");
        setConnecting(false);
        return;
      }
      window.location.href = data.authorizeUrl as string;
    } catch {
      setError("We couldn't start the connection.");
      setConnecting(false);
    }
  }

  /** The private app path: one portal, one pasted token, no OAuth. */
  async function saveToken() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/hubspot/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, token: crmToken }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "We couldn't save that token.");
        return;
      }
      setConnected(true);
      setCrmToken("");
    } catch {
      setError("We couldn't save that token.");
    } finally {
      setSaving(false);
    }
  }

  const tone = status ? TONE[status.verdict] : null;

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <p className="label mb-2">Check your feed</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Is Google collecting your values?
        </h1>
        <p className="mt-2 max-w-[66ch] text-[15px] text-[var(--muted)]">
          Google fetches your feed on its own schedule and tells you nothing
          either way. Paste your feed URL and we&apos;ll show you every time it
          has come to collect.
        </p>

        <section className="card mt-8 p-5">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !checking && url.trim() && void check()}
              placeholder="https://…/v1/feeds/google-ads/vbb_live_….csv"
              className="input mono min-w-0 flex-1 text-[13px]"
              aria-label="Your feed URL"
            />
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking || !url.trim()}
              className="btn btn-primary shrink-0"
            >
              {checking ? "Checking…" : "Check"}
              {!checking && <ArrowIcon />}
            </button>
          </div>
          <p className="mt-2 text-[12.5px] text-[var(--muted)]">
            Checking doesn&apos;t count as a fetch — it won&apos;t use up the
            collection budget Google needs.
          </p>

          {error && (
            <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-red-50 px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {error}
            </p>
          )}
        </section>

        {status && tone && (
          <section className="card mt-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[14px] font-bold" style={{ color: tone.color }}>
                {tone.dot} {tone.label}
              </p>
              <p className="mono text-[12px] text-[var(--muted)]">
                {status.tokenPrefix}… · {status.rowsPublished.toLocaleString()} rows
                published · {status.currencyCode}
              </p>
            </div>

            <p className="mt-2 max-w-[70ch] text-[13.5px]">{status.message}</p>

            {status.verdict === "never-fetched" && (
              <p className="mt-2.5 max-w-[70ch] text-[12.5px] text-[var(--muted)]">
                If it has been more than a day, the most likely cause is that the
                data source was never saved in Google Ads, or the URL was edited
                and no longer ends in <span className="mono">.csv</span>.
              </p>
            )}

            {status.fetches.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                      <th className="label pb-1.5 font-bold">When</th>
                      <th className="label pb-1.5 font-bold">Result</th>
                      <th className="label pb-1.5 text-right font-bold">Rows served</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.fetches.map((f, i) => (
                      <tr key={`${f.at}-${i}`} className="border-b border-[var(--border)] last:border-0">
                        <td className="mono py-1.5">{when(f.at)}</td>
                        <td className="mono py-1.5">
                          <span
                            style={{
                              color: f.status === 200 ? "var(--accent)" : "var(--danger)",
                            }}
                          >
                            {f.status === 200 ? "collected" : `error ${f.status}`}
                          </span>
                        </td>
                        <td className="mono py-1.5 text-right">
                          {f.status === 200 ? f.rowCount.toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="text-[14px] font-bold">Stop exporting CSVs</p>
              <p className="mt-0.5 max-w-[66ch] text-[13.5px] text-[var(--muted)]">
                Connect HubSpot and this feed refreshes itself every night: we
                read your new deals, price them with the model you already
                saved, and add them for Google to collect. Read-only — nothing
                in your CRM is changed, and no CRM record is stored.
              </p>
              {connected ? (
                <p className="mt-3 rounded-xl border border-[var(--accent)]/30 bg-emerald-50 px-3.5 py-2.5 text-[13px]">
                  <span className="font-semibold text-[var(--accent)]">✓ HubSpot connected.</span>{" "}
                  Tonight&apos;s run will read your new deals and add them to this
                  feed. Nothing else to do.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void connectHubSpot()}
                    disabled={connecting}
                    className="btn btn-primary mt-3 text-[13.5px]"
                  >
                    {connecting ? "Opening HubSpot…" : "Connect HubSpot"}
                    {!connecting && <ArrowIcon />}
                  </button>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12.5px] text-[var(--muted)] underline underline-offset-2">
                      Or paste a private app token instead
                    </summary>
                    <div className="mt-2.5 max-w-[66ch]">
                      <p className="text-[12.5px] text-[var(--muted)]">
                        In HubSpot: Settings → Integrations → Private apps →
                        Create a private app, with the{" "}
                        <span className="mono">deals</span>,{" "}
                        <span className="mono">contacts</span> and{" "}
                        <span className="mono">companies</span> read scopes.
                        Connects this one portal without going through HubSpot&apos;s
                        app review.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input
                          type="password"
                          value={crmToken}
                          onChange={(e) => setCrmToken(e.target.value)}
                          placeholder="Private app token"
                          className="input mono min-w-0 flex-1 text-[13px]"
                          aria-label="HubSpot private app token"
                        />
                        <button
                          type="button"
                          onClick={() => void saveToken()}
                          disabled={saving || !crmToken.trim()}
                          className="btn btn-secondary shrink-0 text-[13px]"
                        >
                          {saving ? "Checking…" : "Connect"}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                        We check it can read all three before storing it, and it
                        is encrypted at rest.
                      </p>
                    </div>
                  </details>
                </>
              )}
            </div>

            {status.verdict === "collecting" && (
              <p className="mt-4 max-w-[70ch] rounded-xl border border-[var(--border)] bg-[#f8fafd] px-3.5 py-2.5 text-[13px] text-[var(--muted)]">
                Values are reaching Google. That does not by itself change how it
                bids — the campaign has to be running{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  Maximize conversion value
                </span>{" "}
                or Target ROAS. On Maximize conversions or Target CPA, Google reads
                these values and bids on none of them.
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
