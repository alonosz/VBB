import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/export/googleAds";

/**
 * Email addresses left voluntarily, and where the person stopped.
 *
 * The value here is not the address. It is the pairing of an address with a
 * point of departure: someone who reached their own model and then left is the
 * most informative churn there is, and today they leave no trace at all.
 *
 * Deliberately small. There is no list to send to, no segmentation, no scoring
 * and nothing derived from their file. A name, a moment, and a place to call
 * from - see the migration for why the schema itself refuses more.
 */

/** Where the box was. Each tells a different story about the person. */
export type LeadSource = "landing" | "report" | "flow";

const SOURCES: LeadSource[] = ["landing", "report", "flow"];

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === "string" && (SOURCES as string[]).includes(value);
}

/**
 * One person is one row however they typed it.
 *
 * Lowercasing only. Not stripping dots, not stripping `+tags`: those are
 * Gmail's rules, not everyone's, and treating `a.b@` and `ab@` as the same
 * person is wrong at any provider that considers them different.
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Whether it is worth storing.
 *
 * Deliberately permissive: the real validation of an email address is sending
 * to it, and a regex strict enough to be meaningful rejects addresses that
 * work. This catches the typo and the empty box, which is what a person needs
 * told while the box is still in front of them.
 */
export function looksLikeEmail(input: string): boolean {
  const value = normalizeEmail(input);
  if (value.length < 6 || value.length > 254) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/** A step label, bounded so the column cannot become a notes field. */
export function cleanStep(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().slice(0, 40);
  return value === "" ? null : value;
}

/** Salted so the table is not a rainbow table of everyone who visited. */
export async function hashCaller(ip: string | null, salt: string): Promise<string | null> {
  if (!ip?.trim()) return null;
  return sha256Hex(`leads:${salt}:${ip.trim()}`);
}

/**
 * How many addresses one caller may leave in an hour.
 *
 * Not a security boundary - anyone determined can change address. It stops the
 * accident and the idle script, which between them are every case that has
 * ever actually filled a table like this with rubbish.
 */
export const MAX_PER_CALLER_PER_HOUR = 5;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

export interface Lead {
  id: string;
  email: string;
  source: LeadSource;
  furthestStep: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewLead {
  email: string;
  source: LeadSource;
  furthestStep: string | null;
  ipHash: string | null;
}

export interface LeadStore {
  /**
   * Record an address, or update the one already there.
   *
   * Coming back further along is the interesting case: the row keeps its
   * original `created_at` (when they first told us) and takes the new step,
   * so "signed up at step 2, left at step 4" survives as one row rather than
   * a unique-constraint error.
   */
  record(lead: NewLead): Promise<Lead>;
  /** How many this caller has left since `since`. Zero for an unknown hash. */
  countSince(ipHash: string | null, since: Date): Promise<number>;
}

interface LeadDto {
  id: string;
  email: string;
  source: LeadSource;
  furthest_step: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, email, source, furthest_step, created_at, updated_at";

function toLead(dto: LeadDto): Lead {
  return {
    id: dto.id,
    email: dto.email,
    source: dto.source,
    furthestStep: dto.furthest_step,
    createdAt: new Date(dto.created_at),
    updatedAt: new Date(dto.updated_at),
  };
}

export class SupabaseLeadStore implements LeadStore {
  constructor(private client: SupabaseClient) {}

  async record(lead: NewLead): Promise<Lead> {
    const { data, error } = await this.client
      .from("leads")
      .upsert(
        {
          email: lead.email,
          source: lead.source,
          furthest_step: lead.furthestStep,
          ip_hash: lead.ipHash,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      )
      .select(COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return toLead(data as LeadDto);
  }

  async countSince(ipHash: string | null, since: Date): Promise<number> {
    // No hash means no caller to count. Returning zero rather than refusing
    // keeps a proxy that strips the header from locking everyone out.
    if (!ipHash) return 0;

    const { count, error } = await this.client
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since.toISOString());

    if (error) throw new Error(error.message);
    return count ?? 0;
  }
}

// ---------------------------------------------------------------------------
// In-memory, for tests
// ---------------------------------------------------------------------------

export class InMemoryLeadStore implements LeadStore {
  private rows = new Map<string, Lead & { ipHash: string | null }>();
  private seq = 0;

  constructor(private now: () => Date = () => new Date()) {}

  async record(lead: NewLead): Promise<Lead> {
    const existing = this.rows.get(lead.email);
    const row = {
      id: existing?.id ?? `lead-${++this.seq}`,
      email: lead.email,
      source: lead.source,
      furthestStep: lead.furthestStep,
      ipHash: lead.ipHash,
      createdAt: existing?.createdAt ?? this.now(),
      updatedAt: this.now(),
    };
    this.rows.set(lead.email, row);
    return { ...row };
  }

  async countSince(ipHash: string | null, since: Date): Promise<number> {
    if (!ipHash) return 0;
    return [...this.rows.values()].filter(
      (r) => r.ipHash === ipHash && r.createdAt >= since
    ).length;
  }

  /** Test-only: the churn list an operator would read. */
  async list(): Promise<Lead[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }
}
