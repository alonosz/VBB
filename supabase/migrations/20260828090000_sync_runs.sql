-- VBB Engine — what happened on each scheduled run.
--
-- The nightly job already recorded its outcome on the connection, which
-- answers "did the last run work" and nothing else. The failure that actually
-- ends a pilot is quieter than that: the cron stops firing. Vercel drops the
-- schedule, the secret rotates, a deploy removes it — and last_sync_at simply
-- stops moving. Nobody is watching a timestamp that does not change.
--
-- A run that happened leaves a row. A run that should have happened and did
-- not leaves a gap, and a gap is visible in a way a stale field is not: the
-- workspace page can say "the last run was three days ago" because it knows
-- what a normal night looks like.
--
-- The counts here are the ones an operator is asked about — how many leads
-- went to Google, how many were skipped and why, how many moved too late to
-- act on. None of it identifies a lead: totals and reasons, never a row.

create table if not exists public.sync_runs (
  id bigserial primary key,

  -- Kept when the feed is deleted, so a workspace's history does not vanish
  -- with the feed it describes.
  feed_id uuid references public.feeds (id) on delete set null,
  client_id uuid references public.workspaces (id) on delete cascade,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  -- 'ok'       the run priced and published whatever was new
  -- 'refused'  the run declined on purpose, and said why
  -- 'failed'   something broke; nothing was published
  status text not null,

  -- What the CRM returned, before pricing.
  deals_pulled integer not null default 0,

  -- What reached Google, and what deliberately did not.
  rows_published integer not null default 0,
  new_conversions integer not null default 0,
  adjustments integer not null default 0,
  recalibration_only integer not null default 0,
  unchanged integer not null default 0,
  skipped integer not null default 0,

  -- One sentence a person can act on. Never a stack trace, never CRM data.
  message text,

  -- Which frozen model priced this run, so a value can be traced to its rules.
  model_id text,

  constraint sync_runs_status_known check (status in ('ok', 'refused', 'failed')),
  constraint sync_runs_counts_are_not_negative check (
    deals_pulled >= 0 and rows_published >= 0 and new_conversions >= 0
    and adjustments >= 0 and recalibration_only >= 0 and unchanged >= 0 and skipped >= 0
  ),
  constraint sync_runs_message_is_a_sentence check (
    message is null or length(message) <= 500
  ),
  -- A successful run that published nothing is normal — there may have been no
  -- new leads. A successful run that says why it refused is a contradiction.
  constraint sync_runs_refusal_has_a_reason check (
    status <> 'refused' or message is not null
  )
);

comment on table public.sync_runs is
  'One row per scheduled run. A missing row is the signal: it means the cron did not fire.';

-- The workspace page asks for the last few runs for one customer.
create index if not exists sync_runs_by_workspace
  on public.sync_runs (client_id, started_at desc);

create index if not exists sync_runs_by_feed
  on public.sync_runs (feed_id, started_at desc);

alter table public.sync_runs enable row level security;
