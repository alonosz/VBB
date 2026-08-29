import { NextResponse } from "next/server";
import { workspaceRepositoryFromEnv } from "@/lib/workspace/env";
import { authorizeWorkspace } from "@/lib/workspace/authorize";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { INTAKE_SYSTEM_PROMPT, buildIntakeUserMessage } from "@/lib/intake/prompt";
import { EMPTY_PROPOSAL, FIELD_KEYS, sanitizeProposal } from "@/lib/intake/proposal";
import type { ColumnProfile } from "@/lib/intake/profile";

/**
 * One assisted-intake call per upload.
 *
 * It proposes a column mapping and writes down the advertiser's claims. It
 * never returns a value, and nothing it returns is used without passing
 * through sanitizeProposal first. Every failure path returns 200 with a
 * reason: the diagnostic runs on header heuristics alone, so an outage here
 * must never stop someone from getting their report.
 */

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * A fast model on purpose. The job is reading a short description against a
 * list of column descriptions - it needs comprehension, not depth - and the
 * flow only waits a few seconds for it, so latency matters more here than
 * headroom. Override with VBB_INTAKE_MODEL if you want a stronger one.
 */
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_COLUMNS = 120;

const ProposalSchema = z.object({
  columnMapping: z
    .array(
      z.object({
        field: z.enum(FIELD_KEYS),
        column: z.string(),
        why: z.string(),
      })
    )
    .describe("One entry per field you can confidently place. Omit the rest."),
  candidateFactors: z
    .array(
      z.object({
        column: z.string(),
        statedLevels: z.array(z.string()),
        userClaim: z.string(),
      })
    )
    .describe("Claims the advertiser made about which leads are worth more."),
  statedCycleDaysMin: z.number().nullable(),
  statedCycleDaysMax: z.number().nullable(),
  statedCycleLabel: z.string().nullable().describe("Their own phrasing, e.g. '2-3 months'."),
  statedLeadsPerMonthMin: z.number().nullable(),
  statedLeadsPerMonthMax: z.number().nullable(),
  statedSources: z.array(z.string()),
});

interface IntakeRequestBody {
  businessContext?: unknown;
  columns?: unknown;
  /** Whose call this is. The endpoint spends money, so it has an owner. */
  workspaceKey?: unknown;
}

function fail(reason: string, status = 200) {
  return NextResponse.json({ ok: false, reason, proposal: EMPTY_PROPOSAL }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail("No API key is configured, so the mapping suggestion was skipped.");
  }

  let body: IntakeRequestBody;
  try {
    body = (await request.json()) as IntakeRequestBody;
  } catch {
    return fail("The request could not be read.", 400);
  }

  // This is the one endpoint that spends money per call, and it was reachable
  // by anyone who found it. It now belongs to a customer.
  //
  // A refusal is not an error the flow has to handle: it returns the same
  // shape as a missing API key, so the mapping screen falls back to header
  // matching and says why, exactly as it always has.
  const workspaces = workspaceRepositoryFromEnv();
  if (!workspaces) {
    return fail("Workspaces are not configured, so the mapping suggestion was skipped.");
  }
  const auth = await authorizeWorkspace(workspaces, body.workspaceKey);
  if (!auth.ok) {
    return fail(
      "Open your workspace page first so we know whose account this is - until then we match columns by name only."
    );
  }

  const businessContext =
    typeof body.businessContext === "string" ? body.businessContext.slice(0, MAX_CONTEXT_CHARS) : "";
  const columns = Array.isArray(body.columns)
    ? (body.columns as ColumnProfile[]).slice(0, MAX_COLUMNS)
    : [];

  if (columns.length === 0) return fail("No columns were sent.", 400);
  if (!businessContext.trim()) {
    return fail("You skipped the description, so there was nothing to match columns against.");
  }

  const headers = columns.map((c) => c.name).filter((n): n is string => typeof n === "string");

  const client = new Anthropic({
    apiKey,
    // One retry, per the rule that this call never blocks the flow.
    maxRetries: 1,
    timeout: REQUEST_TIMEOUT_MS,
  });

  try {
    const response = await client.messages.parse({
      model: process.env.VBB_INTAKE_MODEL || DEFAULT_MODEL,
      max_tokens: 4096,
      system: INTAKE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildIntakeUserMessage(businessContext, columns) }],
      output_config: { format: zodOutputFormat(ProposalSchema) },
    });

    if (!response.parsed_output) {
      return fail("The mapping suggestion came back unreadable, so we used our own column matching.");
    }

    return NextResponse.json({
      ok: true,
      reason: null,
      proposal: sanitizeProposal(response.parsed_output, headers),
      model: response.model,
    });
  } catch (error) {
    return fail(describeError(error));
  }
}

/**
 * Errors are for the advertiser, not for a log. Each one says what happened
 * and what it means for their report - which is always "nothing, we used our
 * own column matching instead".
 */
function describeError(error: unknown): string {
  const fallback = "we used our own column matching instead";
  if (error instanceof Anthropic.AuthenticationError) {
    return `The mapping suggestion is not set up correctly - ${fallback}.`;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return `The mapping suggestion hit a rate limit - ${fallback}.`;
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return `The mapping suggestion took too long - ${fallback}.`;
  }
  if (error instanceof Anthropic.APIError) {
    return `The mapping suggestion failed (${error.status ?? "no status"}) - ${fallback}.`;
  }
  return `The mapping suggestion could not run - ${fallback}.`;
}
