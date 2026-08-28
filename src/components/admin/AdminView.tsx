"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";

/**
 * The operator's screen: who the customers are, and adding one.
 *
 * This existed only as a terminal command, which is not a thing the person
 * running five pilots can be expected to have. Everything the command did is
 * here.
 *
 * The new customer's key is shown once, large, with a copy button and a plain
 * warning — an operator who assumes they can look it up later will lose it,
 * and only a hash is stored.
 */

interface Workspace {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  createdAt: string;
}

const ADMIN_STORE = "vbb.adminKey.v1";

export function AdminView() {
  const [adminKey, setAdminKey] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const [newName, setNewName] = useState("");
  const [issued, setIssued] = useState<
    { name: string; url: string; expiresAt: string } | null
  >(null);
  const [copied, setCopied] = useState(false);

  const call = useCallback(
    async (payload: Record<string, unknown>, key: string) => {
      const res = await fetch("/api/admin/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, adminKey: key }),
      });
      return { res, data: await res.json() };
    },
    []
  );

  const load = useCallback(
    async (key: string, remember: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const { res, data } = await call({ action: "list" }, key);
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Could not sign in.");
          setSignedIn(false);
          if (remember) try { localStorage.removeItem(ADMIN_STORE); } catch {}
          return;
        }
        setWorkspaces(data.workspaces as Workspace[]);
        setSignedIn(true);
        if (remember) try { localStorage.setItem(ADMIN_STORE, key); } catch {}
      } catch {
        setError("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [call]
  );

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(ADMIN_STORE); } catch { saved = null; }
    if (!saved) return;
    // Deferred so the state this sets lands outside the effect's body.
    const id = setTimeout(() => {
      setAdminKey(saved);
      void load(saved, false);
    }, 0);
    return () => clearTimeout(id);
  }, [load]);

  async function createWorkspace() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await call({ action: "create", name: newName.trim() }, adminKey);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not create that customer.");
        return;
      }
      setIssued({
        name: data.workspace.name as string,
        url: data.inviteUrl as string,
        expiresAt: data.expiresAt as string,
      });
      setNewName("");
      await load(adminKey, false);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A fresh link for someone who lost their key.
   *
   * Redeeming it mints a new key and retires the old one, so this is both
   * "send them a link" and "rotate their credential". Everything they own —
   * feed, model, CRM connection — stays attached, which is the whole reason
   * this exists rather than making a second customer.
   */
  async function sendLink(id: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await call({ action: "invite", workspaceId: id }, adminKey);
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not create a link.");
        return;
      }
      setIssued({
        name,
        url: data.inviteUrl as string,
        expiresAt: data.expiresAt as string,
      });
    } finally {
      setBusy(false);
    }
  }

  async function suspend(id: string, name: string) {
    if (!confirm(`Suspend ${name}? Their workspace key stops working immediately. Their feed keeps serving Google until you revoke it separately.`)) return;
    setBusy(true);
    await call({ action: "suspend", workspaceId: id }, adminKey);
    await load(adminKey, false);
    setBusy(false);
  }

  function copyLink() {
    if (!issued) return;
    void navigator.clipboard.writeText(issued.url).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2500); },
      () => {}
    );
  }

  if (!signedIn) {
    return (
      <div className="animate-page-in flex min-h-screen flex-col">
        <main className="mx-auto w-full max-w-lg flex-1 px-6 py-20">
          <p className="label mb-2">Operator</p>
          <h1 className="text-3xl font-bold tracking-tight text-balance">Your customers</h1>
          <p className="mt-2 text-[15px] text-[var(--muted)]">
            Enter your admin password. This is the one password you keep — it is
            not a customer&apos;s workspace key.
          </p>
          <div className="card mt-8 p-5">
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && adminKey.trim() && void load(adminKey, true)}
                placeholder="Admin password"
                className="input min-w-0 flex-1 text-[14px]"
                aria-label="Admin password"
              />
              <button
                type="button"
                onClick={() => void load(adminKey, true)}
                disabled={busy || !adminKey.trim()}
                className="btn btn-primary shrink-0"
              >
                {busy ? "Checking…" : "Sign in"}
                {!busy && <ArrowIcon />}
              </button>
            </div>
            {error && (
              <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
                {error}
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="animate-page-in flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="label mb-1">Operator</p>
            <h1 className="text-3xl font-bold tracking-tight">Your customers</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              try { localStorage.removeItem(ADMIN_STORE); } catch {}
              setSignedIn(false);
              setAdminKey("");
            }}
            className="btn btn-ghost text-xs"
          >
            Sign out
          </button>
        </div>

        {/* The link, once. */}
        {issued && (
          <section className="panel-navy mt-6 p-5 sm:p-6">
            <p className="label" style={{ color: "var(--on-navy-muted)" }}>
              Send this to {issued.name}
            </p>
            <p className="mt-1.5 text-[16px] font-bold" style={{ color: "var(--on-navy)" }}>
              Their sign-in link
            </p>
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <code
                className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--navy-line)] bg-black/30 px-3 py-2.5 text-[12.5px]"
                style={{ color: "var(--on-navy)" }}
              >
                {issued.url}
              </code>
              <button type="button" onClick={copyLink} className="btn btn-primary shrink-0 text-[13px]">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p
              className="mt-3 max-w-[68ch] text-[13px]"
              style={{ color: "var(--on-navy-muted)" }}
            >
              Works once, and expires{" "}
              <span className="mono" style={{ color: "var(--on-navy)" }}>
                {new Date(issued.expiresAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              . Clicking it signs their browser in — they never see or type a key.
              If they lose access, send another from the list below; everything
              they own stays attached.
            </p>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="mt-3 text-[12.5px] underline underline-offset-2"
              style={{ color: "var(--on-navy-muted)" }}
            >
              I&apos;ve sent it — hide this
            </button>
          </section>
        )}

        {/* Add one. */}
        <section className="card mt-5 p-5">
          <p className="text-[14px] font-bold">Add a customer</p>
          <p className="mt-0.5 text-[13.5px] text-[var(--muted)]">
            Whatever you call them internally. It only appears on their own page.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void createWorkspace()}
              placeholder="Northridge Fabrication"
              className="input min-w-0 flex-1 text-[14px]"
              aria-label="Customer name"
            />
            <button
              type="button"
              onClick={() => void createWorkspace()}
              disabled={busy || !newName.trim()}
              className="btn btn-primary shrink-0"
            >
              {busy ? "Creating…" : "Create"}
              {!busy && <ArrowIcon />}
            </button>
          </div>
          {error && (
            <p className="mt-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {error}
            </p>
          )}
        </section>

        {/* The list. */}
        <section className="card mt-4 p-5">
          <p className="text-[14px] font-bold">
            {workspaces.length === 0
              ? "No customers yet"
              : `${workspaces.length} customer${workspaces.length === 1 ? "" : "s"}`}
          </p>
          {workspaces.length === 0 ? (
            <p className="mt-1 text-[13.5px] text-[var(--muted)]">
              Add your first one above. You will get a key to send them.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                    <th className="label pb-1.5 font-bold">Name</th>
                    <th className="label pb-1.5 font-bold">Key</th>
                    <th className="label pb-1.5 font-bold">Status</th>
                    <th className="label pb-1.5 font-bold">Added</th>
                    <th className="pb-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {workspaces.map((w) => (
                    <tr key={w.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 font-semibold">{w.name}</td>
                      <td className="mono py-2 text-[12px] text-[var(--muted)]">{w.keyPrefix}…</td>
                      <td className="mono py-2">
                        <span style={{ color: w.status === "active" ? "var(--accent)" : "var(--muted)" }}>
                          {w.status}
                        </span>
                      </td>
                      <td className="mono py-2 text-[12px] text-[var(--muted)]">
                        {new Date(w.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-right">
                        {w.status === "active" && (
                          <span className="flex justify-end gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void sendLink(w.id, w.name)}
                              title="Mints a new key when they click it. Their old one stops working."
                              className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-[var(--primary)] hover:bg-[var(--primary-soft)] disabled:opacity-50"
                            >
                              Send a link
                            </button>
                            <button
                              type="button"
                              onClick={() => void suspend(w.id, w.name)}
                              className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--danger)]"
                            >
                              Suspend
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
