import { NextResponse } from "next/server";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";

/**
 * Recording the day an advertiser switched to value-based bidding.
 *
 * The whole "did it work" comparison hangs off this one timestamp, and it is
 * the only part of it nobody can work out later. Three months from now the
 * date is gone: the campaign history will not say it, the CRM will not say it,
 * and the advertiser will not remember the week. So it is written down the day
 * it happens, in one field, and everything else is recomputed from it.
 *
 * Nothing about their deals is stored here. The two cohorts are derived from
 * the CRM window in the browser each time, so the server holds a date and
 * nothing more.
 */

export const runtime = "nodejs";

/**
 * How far back a switch may be backdated.
 *
 * Somebody who switched last month and is telling us now is the ordinary case,
 * and refusing them would lose a real comparison. A date from two years ago is
 * a typo or a misunderstanding, and it would silently put every lead in the
 * "after" cohort with nothing to compare against.
 */
const MAX_BACKDATE_DAYS = 180;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const workspaces = workspaceRepositoryFromEnv();
  if (!workspaces) {
    return bad("This deployment has no workspace store configured.", 503);
  }

  let body: { workspaceKey?: unknown; switchedAt?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("That request could not be read.");
  }

  // Recording something against a workspace needs the workspace key. Unlike
  // connecting, there is nothing to mint here: a switch date belongs to an
  // advertiser who already exists.
  const auth = await authorizeWorkspace(
    workspaces,
    typeof body.workspaceKey === "string" ? body.workspaceKey : ""
  );
  if (!auth.ok) return bad(auth.error, auth.status);

  // Null clears it, for somebody who recorded the wrong day.
  if (body.switchedAt === null) {
    await workspaces.setSwitchedAt(auth.workspace.id, null);
    return NextResponse.json({ ok: true, switchedAt: null });
  }

  if (typeof body.switchedAt !== "string") {
    return bad("Say which day the bid strategy changed.");
  }

  const at = new Date(body.switchedAt);
  if (Number.isNaN(at.getTime())) return bad("That is not a date we can read.");

  const now = new Date();
  // A day of slack for a clock that disagrees with ours. Beyond that, a future
  // date would put every lead in the "before" cohort and compare against
  // nothing.
  if (at.getTime() > now.getTime() + 86_400_000) {
    return bad("That date is in the future. Record the switch on the day you make it.");
  }
  if (at.getTime() < now.getTime() - MAX_BACKDATE_DAYS * 86_400_000) {
    return bad(
      `That is more than ${MAX_BACKDATE_DAYS} days ago. We can only compare against leads ` +
        "still inside your CRM window, so a switch that old cannot be measured."
    );
  }

  await workspaces.setSwitchedAt(auth.workspace.id, at);
  return NextResponse.json({ ok: true, switchedAt: at.toISOString() });
}

/** What we already know, so the screen can show it without asking again. */
export async function GET(request: Request) {
  const workspaces = workspaceRepositoryFromEnv();
  if (!workspaces) return bad("This deployment has no workspace store configured.", 503);

  const key = new URL(request.url).searchParams.get("workspaceKey") ?? "";
  const auth = await authorizeWorkspace(workspaces, key);
  if (!auth.ok) return bad(auth.error, auth.status);

  return NextResponse.json({
    ok: true,
    switchedAt: auth.workspace.valueBiddingSwitchedAt?.toISOString() ?? null,
  });
}
