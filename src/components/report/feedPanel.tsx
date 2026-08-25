"use client";

import { useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * Turning the model into a URL Google fetches by itself.
 *
 * This is the step that ends the daily chore: the advertiser pastes one URL
 * into Google Ads, and every future publish reaches Google without anyone
 * touching a file again.
 */

export interface PublishedFeed {
  feedUrl: string;
  rowsPublished: number;
  identifier: "clickId" | "email";
}

export function FeedSection({
  published,
  publishing,
  error,
  onPublish,
  summary,
}: {
  published: PublishedFeed | null;
  publishing: boolean;
  error: string | null;
  onPublish: () => void;
  summary: string;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!published) return;
    try {
      await navigator.clipboard.writeText(published.feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Some browsers refuse the clipboard without a gesture they recognise.
      // The URL is on screen and selectable, so this is not worth an error.
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--border)]/70 pt-4">
      {!published ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onPublish}
              disabled={publishing}
              className="btn btn-primary"
            >
              {publishing ? "Publishing…" : "Generate Google Ads feed URL"}
              {!publishing && <ArrowIcon />}
            </button>
            <span className="max-w-[46ch] text-[12.5px] text-[var(--muted)]">
              {summary}
            </span>
          </div>
          {error && (
            <p className="mt-2.5 rounded-xl border border-[var(--danger)]/30 bg-red-50 px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-[var(--primary)]/30 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13.5px] font-bold">Your feed is live</p>
            <p className="mono text-[12px] text-[var(--muted)]">
              {published.rowsPublished.toLocaleString()} conversions ·{" "}
              {published.identifier === "clickId" ? "click ID" : "hashed email"}
            </p>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-[var(--border)] bg-[#f8fafd] px-3 py-2 text-[12px]">
              {published.feedUrl}
            </code>
            <button type="button" onClick={copy} className="btn btn-secondary shrink-0 text-[13px]">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="mt-2.5 max-w-[74ch] text-[12.5px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--warn)]">Copy it now.</span> The key
            in this URL is stored only as a hash, so we cannot show it to you again — and
            anyone who has it can fetch the feed. Generate a new one if it ever leaks.
          </p>

          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="mt-3 text-[13px] font-semibold text-[var(--primary)] underline underline-offset-[3px] hover:text-[var(--primary-hover)]"
          >
            Where does this go in Google Ads?
          </button>
        </div>
      )}

      {guideOpen && published && (
        <SetupGuide feedUrl={published.feedUrl} onClose={() => setGuideOpen(false)} />
      )}
    </div>
  );
}

const STEPS = [
  {
    title: "Open your conversion uploads",
    body: "In Google Ads, go to Tools & Settings → Measurement → Conversions, then open the Uploads tab.",
  },
  {
    title: "Add a schedule",
    body: "Open the Schedules tab and click the plus button. Choose HTTPS as the source.",
  },
  {
    title: "Paste your feed URL",
    body: "Paste the URL you just copied, then pick how often Google should fetch it. Daily is right for most accounts — twice a day if your leads arrive around the clock.",
  },
  {
    title: "Preview, then save",
    body: "Use Preview to check Google reads the file. You should see one row per lead with its own value. Save, and you are done — no one has to touch a file again.",
  },
];

function SetupGuide({ feedUrl, onClose }: { feedUrl: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--navy)]/45 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Google Ads setup guide"
      onClick={onClose}
    >
      <div
        className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label">Four steps, once</p>
            <h3 className="mt-1 text-xl font-bold tracking-tight">
              Set up the scheduled upload
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg px-2 py-1 text-[18px] leading-none text-[var(--muted)] hover:bg-[#f1f3f8]"
          >
            ×
          </button>
        </div>

        <ol className="mt-4 grid gap-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[12px] font-bold text-[var(--primary)]">
                {i + 1}
              </span>
              <span>
                <span className="block text-[14px] font-semibold">{step.title}</span>
                <span className="mt-0.5 block max-w-[56ch] text-[13.5px] text-[var(--muted)]">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[#f8fafd] p-3">
          <p className="label mb-1">Your feed URL</p>
          <code className="mono block overflow-x-auto whitespace-nowrap text-[11.5px]">
            {feedUrl}
          </code>
        </div>

        <p className="mt-3 max-w-[60ch] text-[12.5px] text-[var(--muted)]">
          Google fetches on the schedule you set. Publish again whenever you have new
          leads and the same URL serves them — you never have to repeat this.
        </p>

        <button type="button" onClick={onClose} className="btn btn-primary mt-4">
          Got it
        </button>
      </div>
    </div>
  );
}
