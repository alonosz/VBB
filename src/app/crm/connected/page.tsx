import Link from "next/link";

/**
 * Where HubSpot sends people back to.
 *
 * The callback has already done the work; this only reports what happened. The
 * reason text is written by the callback, never by HubSpot, so nothing
 * attacker-controlled is rendered here.
 */

export const metadata = { title: "CRM connection · VBB" };

interface Props {
  searchParams: Promise<{ status?: string; reason?: string }>;
}

const SAFE_REASONS = new Set([
  "Connecting a CRM is not set up on this deployment.",
  "HubSpot did not complete the connection.",
  "That link is incomplete. Start the connection again.",
  "That connection link has expired or was altered. Start it again from your feed.",
  "That feed no longer exists.",
  "HubSpot would not complete the connection. Try again.",
  "The connection could not be saved. Nothing was stored.",
]);

export default async function CrmConnectedPage({ searchParams }: Props) {
  const { status, reason } = await searchParams;
  const connected = status === "connected";

  // Only messages this app wrote are shown. A redirect parameter is not a
  // place to let someone else put words on our page.
  const message = reason && SAFE_REASONS.has(reason)
    ? reason
    : "The connection did not complete. Start it again from your feed.";

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
        <p className="label mb-2">HubSpot</p>
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          {connected ? "Your CRM is connected" : "That didn't connect"}
        </h1>

        {connected ? (
          <>
            <p className="mt-3 max-w-[66ch] text-[15px] text-[var(--muted)]">
              From tonight, your feed refreshes itself. We read your deals once a
              day, price the new ones with your saved model, and add them for
              Google to collect — no export, nothing to remember.
            </p>
            <div className="card mt-6 p-5">
              <p className="text-[14px] font-bold">What happens next</p>
              <ul className="mt-2 grid gap-2 text-[13.5px] text-[var(--muted)]">
                {[
                  "We read deals, and the contacts and companies attached to them. Read-only — nothing in your CRM is ever changed.",
                  "Your saved model prices them exactly as it does on screen. Nothing is refitted behind you.",
                  "A lead already sent is not sent again. A value that moved is only restated while Google will still act on it.",
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="text-[var(--accent)]">✓</span>
                    <span className="max-w-[68ch]">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-5 text-[13.5px] text-[var(--muted)]">
              You can check what it has done, any time, on{" "}
              <Link href="/feed-status" className="font-semibold text-[var(--primary)] underline underline-offset-2">
                your feed status page
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 max-w-[66ch] text-[15px]">{message}</p>
            <p className="mt-4 text-[13.5px] text-[var(--muted)]">
              Nothing was changed, and nothing was stored. Start again from{" "}
              <Link href="/feed-status" className="font-semibold text-[var(--primary)] underline underline-offset-2">
                your feed status page
              </Link>
              .
            </p>
          </>
        )}
      </main>
    </div>
  );
}
