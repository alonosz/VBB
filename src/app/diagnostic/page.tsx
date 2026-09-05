"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { generateDemoDeals, demoDealsToCsvRows } from "@/lib/fixtures/demoDataset";
import { CONSUMER_EXAMPLE, generateConsumerDemoRows } from "@/lib/fixtures/consumerDataset";
import type { Audience } from "@/lib/analysis/types";
import { SIZE_BANDS, describeSizeSelection } from "@/lib/analysis/statedProfile";
import { useIngest } from "@/lib/diagnostic/useIngest";
import { Stepper } from "@/components/diagnostic/Stepper";
import { PageHead } from "@/components/ui";
import { ArrowIcon } from "@/components/ArrowIcon";

// Tuned to match the shape of the demo dataset, so the walkthrough surfaces
// the one comparison that actually matters (cycle length) rather than a
// spurious volume gap caused by the sample text disagreeing with the sample data.
const EXAMPLE =
  "We sell workflow software to mid-market manufacturers, usually 200–1000 employees. " +
  "Our buyers are ops directors and plant managers. Sales cycle is usually about 2–3 months, " +
  "longer for the bigger accounts. We get maybe 80–100 leads a month. Our best customers " +
  "come through referrals and webinars - they close faster and stick around longer.";

export default function IntakePage() {
  const router = useRouter();
  const {
    audience, setAudience,
    businessContext, setBusinessContext,
    statedCycleDays, setStatedCycleDays,
    statedSizeBands, setStatedSizeBands,
  } = useDiagnostic();
  const consumer = audience === "b2c";
  const example = consumer ? CONSUMER_EXAMPLE : EXAMPLE;

  function nudgeCycle(by: number) {
    setStatedCycleDays(Math.max(1, Math.min(730, (statedCycleDays ?? 30) + by)));
  }

  function toggleBand(id: string) {
    setStatedSizeBands(
      statedSizeBands.includes(id)
        ? statedSizeBands.filter((b) => b !== id)
        : [...statedSizeBands, id]
    );
  }
  const [loadingSample, setLoadingSample] = useState(false);
  const ingest = useIngest();

  async function trySample() {
    setLoadingSample(true);
    const description = businessContext.trim() || example;
    if (!businessContext.trim()) {
      setBusinessContext(example);
      // Stated claims belong to the sample too. Without them the walkthrough
      // reaches stated-versus-actual with nothing stated to compare.
      if (statedCycleDays === null) setStatedCycleDays(consumer ? 10 : 75);
      if (statedSizeBands.length === 0 && !consumer) setStatedSizeBands(["100-1000"]);
    }
    // Each audience gets a sample shaped like its own world. A consumer
    // walking through a B2B file learns that the product is for somebody else.
    const rows = consumer
      ? generateConsumerDemoRows()
      : demoDealsToCsvRows(generateDemoDeals());
    await ingest({
      name: consumer ? "sample_quote_requests.csv" : "sample_b2b_deals.csv",
      sizeBytes: consumer ? 190_000 : 248_000,
      headers: Object.keys(rows[0]),
      rows,
      businessContext: description,
    });
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="intake" />
      <main className="page animate-page-in flex-1 py-10">
        <PageHead
          eyebrow="Step 1 of 5 · Your business"
          title="Tell us about your business"
          lede="Nothing here changes what your leads are worth. We hold it next to what your data actually says and show you where the two disagree - usually the most useful page in the report."
        />

        {/*
          Asked first, because it decides what the rest of the page asks.

          Headcount, industry and job title describe a company. Asking a law
          firm or an insurance marketplace how big their best customers are
          tells them this tool was built for somebody else, and it was the one
          question on the page that made the product read as B2B when its
          engine never was. The answer also switches off the built-in factors
          that could only mislead on a consumer file.
        */}
        <div className="card mt-8 p-6 sm:p-7">
          <h2 className="h3">Who do you sell to?</h2>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            Only changes what we ask you and which built-in signals we test.
          </p>
          {/*
            Chips, like the size bands below. Two labelled cards explaining
            what a business is and what a consumer is was the tool talking
            down to somebody who runs a marketing team - and the shape said
            "important decision" about a question that takes no thought.
          */}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(
              [
                { id: "b2b", label: "Businesses" },
                { id: "b2c", label: "Consumers" },
              ] as { id: Audience; label: string }[]
            ).map((opt) => {
              const on = audience === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAudience(opt.id)}
                  aria-pressed={on}
                  className={
                    "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors " +
                    (on
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]")
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- the two claims worth asking for straight, first ---- */}
        <div className="card mt-4 p-6 sm:p-7">
          <h2 className="h3">{consumer ? "Start with one number" : "Start with two numbers"}</h2>
          <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[var(--muted)]">
            {consumer ? "Optional. It does not price a lead" : "Both optional. Neither prices a lead"} - your closed deals do that.
          </p>

          {/* Sales cycle */}
          <div className="mt-5">
            <label htmlFor="cycle" className="block text-[14px] font-semibold">
              Typical sales cycle
            </label>
            <p className="mt-0.5 text-[13px] text-[var(--muted)]">
              From first contact to closed, for a deal that goes the distance.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => nudgeCycle(-5)}
                aria-label="Fewer days"
                className="btn btn-secondary h-9 w-9 !px-0 text-[16px]"
              >
                −
              </button>
              <input
                id="cycle"
                type="number"
                min={1}
                max={730}
                value={statedCycleDays ?? ""}
                placeholder="30"
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setStatedCycleDays(e.target.value === "" || !Number.isFinite(n) ? null : n);
                }}
                className="input mono w-24 text-center text-[15px] font-bold"
              />
              <button
                type="button"
                onClick={() => nudgeCycle(5)}
                aria-label="More days"
                className="btn btn-secondary h-9 w-9 !px-0 text-[16px]"
              >
                +
              </button>
              <span className="text-[13.5px] text-[var(--muted)]">
                days
                {statedCycleDays !== null && statedCycleDays >= 60 && (
                  <span className="ml-1.5 text-[var(--muted)]">
                    (about {Math.round(statedCycleDays / 30.44)} months)
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Company size. A consumer has none, so the question is not asked. */}
          {!consumer && (
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <p className="text-[14px] font-semibold">How big are your best customers?</p>
            <p className="mt-0.5 text-[13px] text-[var(--muted)]">
              Headcount. Pick as many as fit - most businesses sell to a range.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {SIZE_BANDS.map((band) => {
                const on = statedSizeBands.includes(band.id);
                return (
                  <button
                    key={band.id}
                    type="button"
                    onClick={() => toggleBand(band.id)}
                    aria-pressed={on}
                    className={
                      "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors " +
                      (on
                        ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-strong)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]")
                    }
                  >
                    {band.label}
                  </button>
                );
              })}
            </div>
            {statedSizeBands.length > 0 && (
              <p className="mt-2.5 text-[13px] text-[var(--muted)]">
                We&apos;ll check how much of your won revenue actually came from
                companies of{" "}
                <span className="mono font-semibold text-[var(--foreground)]">
                  {describeSizeSelection(statedSizeBands)}
                </span>{" "}
                people.
              </p>
            )}
          </div>
          )}
        </div>

        <div className="card mt-4 p-6 sm:p-7">
          <label htmlFor="ctx" className="block text-[16px] font-bold">
            Now describe your business and your ideal customer, in your own words
          </label>
          <p className="mt-1 max-w-[64ch] text-[13.5px] text-[var(--muted)]">
            Who actually buys, and what a good lead looks like to you. AI reads it
            against the columns in your file to work out which is which, and turns
            what you claim about your buyers into things we test against your own
            closed deals. It never decides what a lead is worth - your data does that.
          </p>
          {/*
            Naming the two things that pay off, because "describe your business"
            invites a paragraph of brand adjectives that cannot help. Length is
            not what makes this useful: a column nobody could guess the meaning
            of, and a belief worth checking, are.
          */}
          <p className="mt-2 max-w-[64ch] text-[13.5px] text-[var(--muted)]">
            Two things earn their place here: what any oddly named column in your
            file means, and anything you believe about your buyers that you would
            like checked. Length does nothing on its own.
          </p>
          <textarea
            id="ctx"
            rows={7}
            value={businessContext}
            onChange={(e) => setBusinessContext(e.target.value)}
            placeholder={
              consumer
                ? "e.g. We are a personal injury law firm. Car accidents with an injury are worth far more than slip-and-fall. The matter_type column is the case type, and intake_score is what our paralegal gave it on the first call."
                : "e.g. We sell workflow software to manufacturers. Our buyers are ops directors and plant managers - the ones with a budget line for downtime. I think enterprise closes best. The seg column is company size band, and partner_ref means the lead came from a reseller."
            }
            className="input mt-3.5 min-h-[150px] resize-y bg-[var(--surface-sunken)] p-3.5 text-[15px] leading-relaxed"
          />
          {/*
            There was a "Fill with example text" link here. It pasted the
            sample dataset's own description into the box, which is exactly
            right for the sample and a trap for anybody else: that text is
            written to match the sample's rows, so an advertiser who filled it
            in and then uploaded their own file had their data tested against
            somebody else's claims, and the report refuted them one by one.

            The sample fills its own description when it loads, and the
            placeholder above already shows the shape without becoming the
            answer. Nothing was lost by removing it.
          */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
            <span className="text-[13px] text-[var(--muted)]">
              Free text - nothing here is parsed into a form or required.
            </span>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6">
          <p className="max-w-[54ch] text-[13px] text-[var(--muted)]">
            You can skip this, but the stated-versus-actual comparison is the part
            most people screenshot.
          </p>
          <button
            type="button"
            onClick={() => router.push("/diagnostic/upload")}
            className="btn btn-primary btn-lg"
          >
            Continue to upload <ArrowIcon />
          </button>
        </div>

        {/* No CSV to hand? Walk the whole thing on synthetic data instead. */}
        <div className="well mt-8 flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="text-[14px] font-bold">No export handy?</p>
            <p className="mt-0.5 max-w-[58ch] text-[13.5px] text-[var(--muted)]">
              {consumer
                ? "See the whole thing end to end on a synthetic quote funnel - 600 requests, six months, clearly labelled as sample data throughout."
                : "See the whole thing end to end on a synthetic B2B dataset - 500 deals, six months, clearly labelled as sample data throughout."}
            </p>
          </div>
          <button
            type="button"
            disabled={loadingSample}
            onClick={() => void trySample()}
            className="btn btn-secondary btn-wrap w-full sm:w-auto sm:shrink-0"
          >
            {loadingSample
              ? consumer ? "Building 600 quote requests…" : "Building 500 deals…"
              : consumer
                ? "Try with sample quote funnel (600 synthetic requests)"
                : "Try with sample B2B dataset (500 synthetic deals)"}
          </button>
        </div>
      </main>
    </div>
  );
}
