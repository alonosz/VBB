"use client";

import { useRef } from "react";
import type { Applicability, ModelDrift, SavedValueModel } from "@/lib/model/savedModel";
import { DRIFT_THRESHOLD } from "@/lib/model/savedModel";

/**
 * Which model is pricing these leads, and whether it still should be.
 *
 * Refitting on every upload quietly reprices yesterday's leads. Freezing a
 * model stops that, but a frozen model goes stale — so the two questions have
 * to be answered together, on one panel, with the evidence for each.
 */

const pctText = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n * 100))}%`;

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function ModelSourcePanel({
  saved,
  active,
  drift,
  inert,
  currencyMismatch,
  freshFittedOn,
  onSave,
  onLoadFile,
  onUse,
  onForget,
  notice,
}: {
  saved: SavedValueModel | null;
  active: "fresh" | "saved";
  drift: ModelDrift | null;
  inert: Applicability[];
  currencyMismatch: string | null;
  freshFittedOn: number;
  onSave: () => void;
  onLoadFile: (file: File) => void;
  onUse: (source: "fresh" | "saved") => void;
  onForget: () => void;
  notice: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.1em] text-[var(--muted)]">
            Pricing these leads with
          </p>
          <div className="mt-2.5 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] p-1">
            <button
              type="button"
              onClick={() => onUse("fresh")}
              aria-pressed={active === "fresh"}
              className={
                "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors " +
                (active === "fresh"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]")
              }
            >
              A fresh fit on this file
            </button>
            <button
              type="button"
              onClick={() => onUse("saved")}
              disabled={!saved}
              aria-pressed={active === "saved"}
              className={
                "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 " +
                (active === "saved"
                  ? "bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]")
              }
            >
              My saved model
            </button>
          </div>

          <p className="mt-2.5 max-w-[70ch] text-[13px] text-[var(--muted)]">
            {active === "saved" && saved ? (
              <>
                Fitted{" "}
                <span className="mono">{formatDay(saved.fittedAt)}</span> on{" "}
                <span className="mono">{saved.fittedOn.toLocaleString()}</span> resolved
                deals from{" "}
                <span className="mono">{formatDay(saved.window.from)}</span> to{" "}
                <span className="mono">{formatDay(saved.window.to)}</span>. Its
                multipliers are frozen, so a lead is worth the same today as it was
                yesterday.
              </>
            ) : (
              <>
                Fitted just now on the{" "}
                <span className="mono">{freshFittedOn.toLocaleString()}</span> resolved
                deals in this file. Upload a different date range tomorrow and these
                multipliers change — save the model to stop that.
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={onSave} className="btn btn-secondary text-[13px]">
            {active === "saved" ? "Save the fresh fit" : "Save this model"}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="btn btn-secondary text-[13px]"
          >
            Load a model
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="Load a saved model file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onLoadFile(f);
            }}
          />
        </div>
      </div>

      {notice && (
        <p className="mono mt-3 rounded-xl bg-[var(--primary-soft)] px-3.5 py-2 text-[12.5px] text-[var(--primary)]">
          {notice}
        </p>
      )}

      {saved && currencyMismatch && (
        <div className="mt-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-3">
          <p className="text-[13.5px] font-semibold text-[var(--danger)]">
            Currency mismatch
          </p>
          <p className="mt-0.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
            {currencyMismatch}
          </p>
        </div>
      )}

      {saved && inert.length > 0 && (
        <div className="mt-4 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3">
          <p className="text-[13.5px] font-semibold">
            {inert.length === 1 ? "One saved rule" : `${inert.length} saved rules`} cannot
            fire on this file
          </p>
          <p className="mt-0.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
            {inert.map((f) => f.label).join(", ")} — the column it reads was not mapped
            this time, so it silently does nothing. Map it on the previous step, or refit
            without it.
          </p>
        </div>
      )}

      {saved && drift && <DriftBlock drift={drift} onForget={onForget} />}
    </section>
  );
}

function DriftBlock({ drift, onForget }: { drift: ModelDrift; onForget: () => void }) {
  const refit = drift.verdict === "REFIT";

  return (
    <div className="mt-5 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[14px] font-bold tracking-tight">
          Is your saved model still right?
        </h3>
        <span
          className={
            "rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide " +
            (refit ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--accent-soft)] text-[var(--accent)]")
          }
        >
          {refit ? "Refit recommended" : "Still holding"}
        </span>
      </div>

      <p className="mt-1.5 max-w-[74ch] text-[13px] text-[var(--muted)]">
        {refit ? (
          <>
            Your data has moved further than a saved model should be asked to cover.
            Refit, save the new one, and let it price tomorrow&apos;s leads — a past
            conversion can&apos;t be re-bid, so recalibration is what changes.
          </>
        ) : (
          <>
            Refitting on this file would move your largest multiplier by{" "}
            <span className="mono">{pctText(drift.largestChange)}</span>, inside the{" "}
            <span className="mono">{Math.round(DRIFT_THRESHOLD * 100)}%</span> band. Keep
            the saved model — changing it now would move bids without evidence.
          </>
        )}
      </p>

      {drift.reasons.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {drift.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] text-[var(--muted)]">
              <span className="text-[var(--warn)]">▪</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4" open={refit}>
        <summary className="cursor-pointer text-[12.5px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          {refit ? "Every multiplier, saved against refitted" : "Show every multiplier anyway"}
        </summary>
        <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {["Rule", "Level", "Saved", "Would refit to", "Change"].map((h) => (
                <th
                  key={h}
                  className="pb-2 text-[10.5px] font-bold uppercase tracking-[.07em] text-[var(--muted)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drift.factors.flatMap((f) =>
              f.levels.map((l, i) => (
                <tr key={`${f.key}-${l.level}`} className="border-b border-[var(--border)]">
                  <td className="py-2 pr-3 text-[13px]">
                    {i === 0 ? f.label : ""}
                    {i === 0 && f.status === "added" && (
                      <span className="ml-2 rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--primary)]">
                        new
                      </span>
                    )}
                    {i === 0 && f.status === "removed" && (
                      <span className="ml-2 rounded-full bg-[var(--background-deep)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--muted)]">
                        gone
                      </span>
                    )}
                  </td>
                  <td className="mono py-2 pr-3 text-[12.5px]">{l.level}</td>
                  <td className="mono py-2 pr-3 text-[12.5px]">
                    {l.savedMultiplier === null ? "—" : `${l.savedMultiplier}×`}
                  </td>
                  <td className="mono py-2 pr-3 text-[12.5px]">
                    {l.freshMultiplier === null ? "—" : `${l.freshMultiplier}×`}
                  </td>
                  <td
                    className={
                      "mono py-2 text-[12.5px] " +
                      (l.change !== null && Math.abs(l.change) > DRIFT_THRESHOLD
                        ? "font-bold text-[var(--warn)]"
                        : "text-[var(--muted)]")
                    }
                  >
                    {l.change === null ? "—" : pctText(l.change)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </details>

      <button
        type="button"
        onClick={onForget}
        className="mt-4 text-[12.5px] font-semibold text-[var(--muted)] underline underline-offset-[3px] hover:text-[var(--foreground)]"
      >
        Forget the saved model
      </button>
    </div>
  );
}
