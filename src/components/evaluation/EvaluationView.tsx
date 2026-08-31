"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/ui";
import { ArrowIcon } from "@/components/ArrowIcon";
import { WorkspaceKeyPrompt } from "@/components/workspace/WorkspaceKeyPrompt";
import { DidItWorkPanel } from "@/components/report/didItWork";
import { detectColumns, detectStageTimingColumns } from "@/lib/mapping/detect";
import { rowsToDeals } from "@/lib/mapping/toDeals";
import { runDiagnostic } from "@/lib/analysis";
import { didItWork, type ProofVerdict } from "@/lib/analysis/didItWork";
import { readWorkspaceKey } from "@/lib/workspace/clientKey";
import type { MappedDeal } from "@/lib/analysis/types";

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

export function EvaluationView() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ProofVerdict | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [dealCount, setDealCount] = useState(0);
  const [switchedAt, setSwitchedAt] = useState<Date | null>(null);

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
      setPhase("ready");
    } catch {
      setError("We couldn't reach your CRM. Try again.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    // Queued rather than called: the load sets state as its first act, and
    // doing that synchronously inside an effect renders twice before the page
    // has painted once.
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="page flex-1 py-10">
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
            <p className="mono mt-6 text-[12px] text-[var(--muted)]">
              Read {dealCount.toLocaleString()} deals from your CRM just now
              {switchedAt && ` · switched ${switchedAt.toISOString().slice(0, 10)}`}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
