"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/ui";
import { ArrowIcon } from "@/components/ArrowIcon";
import { WorkspaceKeyPrompt } from "@/components/workspace/WorkspaceKeyPrompt";
import { DidItWorkPanel } from "@/components/report/didItWork";
import { StrategyPanel } from "@/components/report/campaignStrategy";
import { MixShiftPanel } from "@/components/report/mixShift";
import { detectColumns, detectStageTimingColumns } from "@/lib/mapping/detect";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic } from "@/lib/analysis";
import { didItWork, type ProofVerdict } from "@/lib/analysis/didItWork";
import { mixShift, type MixVerdict } from "@/lib/analysis/mixShift";
import { readWorkspaceKey } from "@/lib/workspace/clientKey";
import type { MappedDeal } from "@/lib/analysis/types";
import type { StrategyAudit } from "@/lib/sync/google/campaigns";

/**
 * The screen somebody comes back to.
 *
 * Everything else in this product is a setup flow you walk once. This is the
 * one you return to in six weeks to find out whether any of it worked, so it
 * lives at its own address rather than at the end of onboarding - nobody is
 * going to re-upload a CSV every month to see a number.
 *
 * It reads the CRM live rather than from anything we stored. That is not a
 * workaround: the database deliberately holds no deal records, so the outcomes
 * this needs have to come straight from the customer's own CRM each time. The
 * pull route already passes them through without storing any, which is exactly
 * what makes this possible without changing a single promise.
 */

type Phase = "loading" | "ready" | "no-connection" | "needs-key" | "error";

/**
 * The Google half, which answers a different question from the CRM half.
 *
 * The CRM says whether the leads got better. This says whether Google is even
 * bidding on the values we send, which is the commonest reason the CRM half
 * says nothing changed. It is deliberately allowed to fail on its own: an ads
 * account nobody connected, or a token that lapsed, must not take the outcome
 * comparison down with it.
 */
type AdsState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "audit"; audit: StrategyAudit }
  | { kind: "unavailable"; reason: string };

export function EvaluationView() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ProofVerdict | null>(null);
  const [mix, setMix] = useState<MixVerdict | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [dealCount, setDealCount] = useState(0);
  const [switchedAt, setSwitchedAt] = useState<Date | null>(null);
  const [ads, setAds] = useState<AdsState>({ kind: "off" });

  /**
   * Asked for separately and never awaited by the CRM half.
   *
   * A lapsed Google token or an account nobody has published to yet is a
   * footnote on this screen, not a reason to withhold the outcome comparison
   * that came from somewhere else entirely.
   */
  const loadAds = useCallback(async (key: string) => {
    setAds({ kind: "loading" });
    try {
      const res = await fetch("/api/ads/google/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceKey: key }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAds({
          kind: "unavailable",
          reason: (data.error as string) ?? "We couldn't read your campaigns.",
        });
        return;
      }
      setAds({ kind: "audit", audit: data.strategies as StrategyAudit });
    } catch {
      setAds({ kind: "unavailable", reason: "We couldn't reach Google Ads." });
    }
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);

    const key = readWorkspaceKey();
    if (!key) {
      setPhase("needs-key");
      return;
    }

    try {
      // The switch date first: without it there is nothing to compare and no
      // point pulling a year of deals to find that out.
      const dateRes = await fetch(
        `/api/workspace/switched?workspaceKey=${encodeURIComponent(key)}`
      );
      const dateData = await dateRes.json();
      if (!dateRes.ok || !dateData.ok) {
        if (dateRes.status === 401) {
          setPhase("needs-key");
          return;
        }
        setError(dateData.error ?? "We couldn't read your workspace.");
        setPhase("error");
        return;
      }
      const at = dateData.switchedAt ? new Date(dateData.switchedAt as string) : null;
      setSwitchedAt(at);

      // Started here rather than awaited: the two halves are independent
      // questions and neither should wait on the other's network.
      void loadAds(key);

      const dealsRes = await fetch("/api/crm/hubspot/deals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceKey: key }),
      });
      const deals = await dealsRes.json();

      // No CRM connected is not an error, it is the reason this screen cannot
      // answer yet, and it has its own instruction.
      if (dealsRes.status === 409 || (!dealsRes.ok && !deals.ok && dealsRes.status === 404)) {
        setPhase("no-connection");
        return;
      }
      if (!dealsRes.ok || !deals.ok) {
        setError(deals.error ?? "We couldn't read your deals.");
        setPhase("error");
        return;
      }

      const headers = deals.headers as string[];
      const rows = deals.rows as Record<string, string>[];
      setDealCount(rows.length);

      const reporting =
        (deals.currencies as { code: string; count: number }[] | undefined)?.[0]?.code ?? "USD";
      setCurrency(reporting);

      // Mapped in the browser, exactly as an upload is. Nothing about these
      // rows is sent anywhere.
      const detected = detectColumns(headers, rows);
      const mapped = rowsToDeals({
        rows,
        fields: detected.fields,
        currency: { reportingCurrency: reporting, rates: {}, excludeUnconvertible: false },
        stageTiming: detectStageTimingColumns(headers, rows),
      });

      const diagnostic = runDiagnostic({
        deals: mapped.deals,
        excluded: mapped.excluded,
        currencyCode: reporting,
      });

      setVerdict(
        didItWork({
          deals: mapped.deals as MappedDeal[],
          switchedAt: at,
          medianCycleDays: diagnostic.cycle.medianDays ?? 30,
        })
      );

      // The leading indicator. Answerable from leads that have closed nothing,
      // which is most of them for most of the first year.
      setMix(
        mixShift({
          deals: mapped.deals as MappedDeal[],
          model: diagnostic.valueModel,
          switchedAt: at,
        })
      );
      setPhase("ready");
    } catch {
      setError("We couldn't reach your CRM. Try again.");
      setPhase("error");
    }
  }, [loadAds]);

  useEffect(() => {
    // Queued rather than called: the load sets state as its first act, and
    // doing that synchronously inside an effect renders twice before the page
    // has painted once.
    queueMicrotask(() => void load());
  }, [load]);

  /*
   * No frame of its own. This is a live-mode screen and it was the only one
   * rendering bare: no logo, no navigation, no way back except the browser
   * button, which on the one page somebody bookmarks and returns to reads as
   * having left the product. The shell belongs to the page, so it goes there.
   */
  return (
    <>
      <PageHead
      eyebrow="Evaluation"
      title="Did value-based bidding work?"
      lede="Measured against what actually closed in your CRM, read live each time you open this. Nothing here comes from what we told Google."
    />

    {phase === "loading" && (
      <div className="mt-8 grid gap-3">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
      </div>
    )}

    {phase === "needs-key" && (
      <div className="mt-6">
        <WorkspaceKeyPrompt
          title="Paste your workspace key to see this"
          onSaved={() => void load()}
        />
      </div>
    )}

    {phase === "no-connection" && (
      <div className="well mt-8 p-6">
        <p className="text-[15px] font-bold">Connect your CRM to see this</p>
        <p className="mt-1.5 max-w-[68ch] text-[13.5px] text-[var(--muted)]">
          This compares deals that actually closed, so it has to read your CRM
          each time. We store none of it, which is why there is nothing to show
          until a connection exists.
        </p>
        <a href="/diagnostic/upload" className="btn btn-primary mt-3.5 text-[13.5px]">
          Connect HubSpot
          <ArrowIcon />
        </a>
      </div>
    )}

    {phase === "error" && (
      <div className="alert alert-bad mt-8">
        <p className="text-[13.5px]">{error}</p>
        <button type="button" onClick={() => void load()} className="btn btn-secondary mt-3 text-[13px]">
          Try again
        </button>
      </div>
    )}

    {phase === "ready" && verdict && (
      <>
        <div className="mt-8">
          <DidItWorkPanel
            verdict={verdict}
            currency={currency}
            onRecorded={(at) => {
              setSwitchedAt(at);
              void load();
            }}
          />
        </div>
        {mix && (
          <div className="mt-4">
            <MixShiftPanel verdict={mix} currency={currency} />
          </div>
        )}

        {/*
          The other half of the answer. Leads getting no better is the
          expected result when Google is bidding on lead count, so this
          belongs beside the comparison rather than on a settings screen
          nobody reopens.
        */}
        <section className="card mt-4 p-5 sm:p-6">
          <h2 className="text-[15px] font-bold">Is Google bidding on your values?</h2>
          <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--muted)]">
            Sending values changes nothing on its own. A campaign set to
            Maximize conversions bids on how many leads arrive and ignores
            what they are worth, and Google flags that nowhere.
          </p>
          <div className="mt-3.5">
            {ads.kind === "loading" && <div className="skeleton h-16 rounded-xl" />}
            {ads.kind === "audit" && (
              <StrategyPanel audit={ads.audit} currencyCode={currency} tense="running" />
            )}
            {ads.kind === "unavailable" && (
              <p className="text-[13px] text-[var(--muted)]">{ads.reason}</p>
            )}
          </div>
        </section>

        <p className="mono mt-6 text-[12px] text-[var(--muted)]">
          Read {dealCount.toLocaleString()} deals from your CRM just now
          {switchedAt && ` · switched ${switchedAt.toISOString().slice(0, 10)}`}
          {ads.kind === "audit" &&
            ` · ${ads.audit.campaigns.length} running campaigns read from Google Ads`}
        </p>
    </>
      )}
    </>
  );
}
