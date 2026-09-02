"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Alert } from "@/components/ui";
import { rememberWorkspaceKey } from "@/lib/workspace/clientKey";

/**
 * Setting a customer up without asking them to handle a credential.
 *
 * They click a link and land here. The token in the URL is spent for a freshly
 * minted workspace key, the key is stored in this browser, and they are moved
 * on. The key is never shown - there is nothing for them to copy, lose, or
 * paste into the wrong box.
 *
 * The token is stripped from the address bar as soon as it is spent. It is
 * single-use and already dead by then, but a URL in browser history that looks
 * like a credential invites someone to treat it as one.
 */

type State =
  | { phase: "working" }
  | { phase: "done"; workspaceName: string; returning: boolean }
  | { phase: "failed"; error: string };

export function JoinView() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("t");

  // A missing token is knowable at render, so it is the initial state rather
  // than something an effect sets - setting state synchronously inside an
  // effect is a cascading render, and React lints it for good reason.
  const [state, setState] = useState<State>(() =>
    token
      ? { phase: "working" }
      : {
          phase: "failed",
          error:
            "This link is missing its code. Copy the whole thing from the message you were sent.",
        }
  );

  // Strict Mode runs effects twice in development. A single-use token spent
  // twice is a wasted invite and a confusing "already used" on a link that had
  // never been clicked, so the attempt is guarded.
  const attempted = useRef(false);

  const redeem = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/workspace/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: t }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setState({
          phase: "failed",
          error: data.error ?? "We couldn't open this link.",
        });
        return;
      }

      rememberWorkspaceKey(data.key as string);
      setState({
        phase: "done",
        workspaceName: data.workspaceName as string,
        returning: data.returning === true,
      });
    } catch {
      setState({
        phase: "failed",
        error: "We couldn't reach the server. Check your connection and open the link again.",
      });
    }
  }, []);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    // Out of the address bar and out of the history entry, before anything
    // else renders.
    window.history.replaceState(null, "", "/join");
    void redeem(token);
  }, [token, redeem]);

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <header className="page-wide py-5">
        <Logo size={34} showDotCom />
      </header>

      <main className="page-narrow flex-1 py-16">
        {state.phase === "working" && (
          <>
            <h1 className="h1">Setting up your workspace…</h1>
            <p className="lede mt-2.5">One moment.</p>
            <div className="card mt-8 grid gap-3 p-6">
              <span className="skeleton h-4 w-2/3" />
              <span className="skeleton h-4 w-1/2" />
            </div>
          </>
        )}

        {state.phase === "done" && (
          <>
            <p className="label mb-2">{state.workspaceName}</p>
            <h1 className="h1">You&apos;re in.</h1>
            <p className="lede mt-2.5 max-w-[54ch]">
              This browser is now signed in to your workspace. There is no password
              to remember and nothing to copy down.
            </p>

            {/*
              What they get, in the order they get it.

              The first version of this led with caveats: how long it would
              take, what they would not need, and a warning that Google calls
              the app unverified. All true, and all of it pre-apologising for a
              product nobody had used yet. A page that warns you before it has
              offered you anything reads as unsure of itself.

              So it opens on the report, which is the thing worth their
              afternoon, and the Google consent screen is explained where it
              happens rather than four screens early.
            */}
            {!state.returning && (
              <div className="card mt-8 p-6">
                <h2 className="h3">Fifteen minutes to a number you can argue with</h2>
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[var(--muted)]">
                  What each kind of lead is worth, worked out from the deals you
                  already closed. You will have it at the end of step one.
                </p>

                <ol className="mt-4 grid gap-3.5">
                  {[
                    {
                      n: "1",
                      t: "Your closed deals",
                      b: "Connect HubSpot, or drop in a CSV. It is read in your browser, and no row of it leaves.",
                    },
                    {
                      n: "2",
                      t: "Your numbers",
                      b: "Every figure traces back to your own rows, and every multiplier is yours to change. Nothing is sent anywhere until you say so.",
                    },
                    {
                      n: "3",
                      t: "Into Google Ads",
                      b: "One connection sends the values and names the campaigns still bidding on how many leads you get rather than what they are worth.",
                    },
                  ].map((s) => (
                    <li key={s.n} className="flex gap-3">
                      <span
                        aria-hidden
                        className="mono mt-[1px] flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[11.5px] font-bold text-[var(--primary)]"
                      >
                        {s.n}
                      </span>
                      <span className="max-w-[62ch]">
                        <span className="block text-[14px] font-bold">{s.t}</span>
                        <span className="mt-0.5 block text-[13.5px] text-[var(--muted)]">
                          {s.b}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>

                {/*
                  One line, because both halves of it are the reason people
                  put this off for a fortnight: waiting on a developer, and
                  fearing something will start spending differently on its own.
                */}
                <p className="mt-5 max-w-[64ch] border-t border-[var(--border)] pt-5 text-[13.5px] text-[var(--muted-strong)]">
                  No code goes on your site, and nothing in your ad account
                  changes on its own.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href="/diagnostic" className="btn btn-primary">
                    Start <ArrowIcon />
                  </Link>
                  <button
                    type="button"
                    onClick={() => router.push("/workspace")}
                    className="btn btn-secondary"
                  >
                    Go to your overview
                  </button>
                </div>
              </div>
            )}

            {/*
              Somebody who lost their key wants what they already had, not a
              fresh analysis over the top of the model they are running.
            */}
            {state.returning && (
              <div className="card mt-8 p-6">
                <h2 className="h3">Everything is where you left it</h2>
                <p className="mt-1.5 max-w-[62ch] text-[13.5px] text-[var(--muted)]">
                  Your feed, your saved model and your run history are untouched.
                  The old key stopped working when you opened this link, which is
                  the point of it.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => router.push("/workspace")}
                    className="btn btn-primary"
                  >
                    Go to your overview <ArrowIcon />
                  </button>
                  <Link href="/diagnostic" className="btn btn-secondary">
                    Start a new analysis
                  </Link>
                </div>
              </div>
            )}

            <p className="mt-6 max-w-[62ch] text-[12.5px] text-[var(--muted)]">
              This is this browser on this device, and clearing your browser data
              signs you out. Ask us for another link and you are back - nothing is
              lost.
            </p>
          </>
        )}

        {state.phase === "failed" && (
          <>
            <h1 className="h1">This link didn&apos;t open</h1>
            <div className="mt-6">
              <Alert tone="bad" title="What went wrong">
                <p className="text-[14px]">{state.error}</p>
                <p className="mt-2 text-[13.5px] text-[var(--muted)]">
                  Links work once and last three days. Reply to whoever sent it and
                  ask for another - it takes them a few seconds, and nothing in your
                  workspace is affected.
                </p>
              </Alert>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
