"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { Alert } from "@/components/ui";
import { rememberWorkspaceKey, rememberWorkspaceName } from "@/lib/workspace/clientKey";

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
 *
 * Where they land afterwards matters as much as the credential. This page used
 * to be the destination, which meant somebody handed an invite never saw the
 * front page - not the pitch, not the comparison, not one word of why any of
 * this is worth an afternoon. They were dropped inside a product nobody had
 * described to them. So a new workspace is forwarded to the front page, which
 * greets them by name and then makes the argument; somebody who lost their key
 * has already had the argument and goes to their overview instead.
 */

/*
 * No success state. A redeemed invite forwards rather than reporting, so the
 * only thing this page ever renders for a working link is the moment before
 * it leaves.
 */
type State = { phase: "working" } | { phase: "failed"; error: string };

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
      rememberWorkspaceName(data.workspaceName as string);
      /*
       * replace, not push. Back from the front page should reach wherever they
       * came from, not a spent invite that can only fail.
       */
      router.replace(data.returning === true ? "/workspace" : "/");
    } catch {
      setState({
        phase: "failed",
        error: "We couldn't reach the server. Check your connection and open the link again.",
      });
    }
  }, [router]);

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
