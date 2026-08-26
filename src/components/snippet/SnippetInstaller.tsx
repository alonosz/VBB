"use client";

import { useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * The install page for the click-ID snippet.
 *
 * A lead with a click ID matches an ad click exactly. A lead with only an
 * email relies on Google finding the click itself, and often it doesn't. This
 * is the cheapest thing an advertiser can do to raise their match rate, so the
 * page is one paste and one check, not a setup guide.
 */

interface Finding {
  ok: true;
  checkedUrl: string;
  installed: boolean;
  scriptUrl: string | null;
  hosted: boolean;
  inline: boolean;
  warnings: string[];
}

export function SnippetInstaller({ origin }: { origin: string }) {
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tag = `<script src="${origin}/vbb.js" async></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // The tag is on screen and selectable; not worth an error.
    }
  }

  async function check() {
    setChecking(true);
    setError(null);
    setFinding(null);
    try {
      const res = await fetch(`/api/snippet/verify?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) setError(data.error ?? "We couldn't check that page.");
      else setFinding(data as Finding);
    } catch {
      setError("We couldn't reach that page.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <p className="label mb-2">Raise your match rate</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Capture the ad click on every lead
        </h1>
        <p className="mt-2 max-w-[66ch] text-[15px] text-[var(--muted)]">
          A lead carrying a click ID matches its ad click exactly. A lead with only
          an email relies on Google finding the click itself, and often it can&apos;t.
          This script keeps the click ID from the ad through to your form.
        </p>

        {/* ---- the tag ---- */}
        <section className="card mt-8 p-5">
          <p className="text-[14px] font-bold">Paste this before &lt;/body&gt;</p>
          <p className="mt-0.5 max-w-[66ch] text-[13.5px] text-[var(--muted)]">
            On every page, or in your site&apos;s global footer. It has no
            dependencies and sends nothing anywhere.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-[var(--border)] bg-[#f8fafd] px-3 py-2.5 text-[12.5px]">
              {tag}
            </code>
            <button type="button" onClick={copy} className="btn btn-secondary shrink-0 text-[13px]">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ul className="mt-3.5 grid gap-1.5 text-[13px] text-[var(--muted)]">
            {[
              "Captures gclid, gbraid and wbraid from Google, and fbclid from Meta.",
              "Remembers them for 90 days in a cookie and in local storage, so Safari's seven-day cookie cap doesn't lose them mid-cycle.",
              "Adds them as hidden fields to every form, including forms HubSpot, Typeform or Marketo inject after the page loads.",
              "Never edits a field your site already has.",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-[var(--accent)]">✓</span>
                <span className="max-w-[70ch]">{line}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---- the check ---- */}
        <section className="card mt-5 p-5">
          <p className="text-[14px] font-bold">Then check it&apos;s live</p>
          <p className="mt-0.5 max-w-[66ch] text-[13.5px] text-[var(--muted)]">
            We&apos;ll load one of your pages and look for it.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !checking && url.trim() && void check()}
              placeholder="yoursite.com/contact"
              className="input mono min-w-0 flex-1 text-[13.5px]"
              aria-label="A page on your site"
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

          {error && (
            <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-red-50 px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {error}
            </p>
          )}

          {finding && (
            <div
              className={
                "mt-3 rounded-xl border p-4 " +
                (finding.installed
                  ? "border-emerald-300/60 bg-emerald-50/60"
                  : "border-amber-300/60 bg-amber-50/60")
              }
            >
              <p className="text-[14px] font-bold">
                {finding.installed ? "It's installed" : "We couldn't find it on that page"}
              </p>
              <p className="mono mt-1 text-[12px] text-[var(--muted)]">{finding.checkedUrl}</p>
              <p className="mt-1.5 max-w-[70ch] text-[13.5px] text-[var(--muted)]">
                {finding.installed ? (
                  finding.hosted ? (
                    <>
                      Loading from{" "}
                      <span className="mono">{finding.scriptUrl}</span>. New leads from
                      an ad click will carry their click ID into your CRM.
                    </>
                  ) : (
                    <>
                      Found as a pasted copy rather than a script tag. That works, but
                      the hosted tag above updates itself when we improve it.
                    </>
                  )
                ) : (
                  <>
                    The page loaded, but the script wasn&apos;t in it. Check it was
                    pasted before <span className="mono">&lt;/body&gt;</span>, and that
                    this page is the one you edited.
                  </>
                )}
              </p>
              {finding.warnings.map((w) => (
                <p key={w} className="mt-2 max-w-[70ch] text-[13px] text-amber-800">
                  {w}
                </p>
              ))}
            </div>
          )}
        </section>

        <p className="mt-6 max-w-[74ch] text-[12.5px] text-[var(--muted)]">
          The script stores the click ID on the visitor&apos;s own device and puts it in
          your form. It sends nothing to us, and it collects nothing else.
        </p>
      </main>
    </div>
  );
}
