"use client";

import { useRouter } from "next/navigation";
import { useDiagnostic } from "@/context/DiagnosticContext";
import { Stepper } from "@/components/diagnostic/Stepper";
import { ArrowIcon } from "@/components/ArrowIcon";

// Tuned to match the shape of the demo dataset, so the walkthrough surfaces
// the one comparison that actually matters (cycle length) rather than a
// spurious volume gap caused by the sample text disagreeing with the sample data.
const EXAMPLE =
  "We sell workflow software to mid-market manufacturers, usually 200–1000 employees. " +
  "Our buyers are ops directors and plant managers. Sales cycle is usually about 2–3 months, " +
  "longer for the bigger accounts. We get maybe 80–100 leads a month. Our best customers " +
  "come through referrals and webinars — they close faster and stick around longer.";

export default function IntakePage() {
  const router = useRouter();
  const { businessContext, setBusinessContext } = useDiagnostic();

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <Stepper current="intake" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <p className="label mb-2">Step 1 of 4</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          Tell us about your business
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] text-[var(--muted)]">
          In your own words — no form to fill in. We&apos;ll hold this next to what your
          data actually says and show you where the two disagree. That gap is usually
          the most useful thing in the report.
        </p>

        <div className="card mt-7 p-6">
          <label htmlFor="ctx" className="block max-w-[68ch] text-[15px] font-semibold leading-relaxed">
            Tell us about your business and your ideal customer — sales cycle length,
            monthly lead volume, and who your best customers typically are
            (size, industry, title). A few sentences is enough.
          </label>
          <textarea
            id="ctx"
            rows={7}
            value={businessContext}
            onChange={(e) => setBusinessContext(e.target.value)}
            placeholder="e.g. We sell workflow software to mid-market manufacturers. Our buyers are ops directors. Sales cycle runs about 2–3 months. We get 150–200 leads a month, and our best customers come from referrals…"
            className="input mt-3.5 min-h-[150px] resize-y bg-[#f8fafd] p-3.5 text-[15px] leading-relaxed"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setBusinessContext(EXAMPLE)}
              className="text-[13px] font-semibold text-[var(--primary)] underline underline-offset-[3px] hover:text-[var(--primary-hover)]"
            >
              Fill with example text
            </button>
            <span className="text-[13px] text-[var(--muted)]">
              Free text — nothing here is parsed into a form or required.
            </span>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-[54ch] text-[13px] text-[var(--muted)]">
            You can skip this, but the stated-versus-actual comparison is the part
            most people screenshot.
          </p>
          <button
            type="button"
            onClick={() => router.push("/diagnostic/upload")}
            className="btn btn-primary"
          >
            Continue to upload <ArrowIcon />
          </button>
        </div>
      </main>
    </div>
  );
}
