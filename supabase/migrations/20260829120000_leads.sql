-- VBB Engine - the people who came, and where they stopped.
--
-- Everything in this database until now is something an advertiser explicitly
-- published: rows they approved sending to Google. This table is different in
-- kind, so it is worth being exact about what it may and may not hold.
--
-- What it holds: an email address a visitor typed into a box, when they typed
-- it, and how far through the flow they had got. That is enough for the only
-- question worth asking someone who left - "you reached your own model and
-- then stopped, what happened?" - and it is the whole reason the table exists.
--
-- What it must never hold: anything derived from their file. Not the spread
-- ratio, not the lead count, not a deal value, not a segment name, not the
-- verdict. Nothing touches this server until a customer publishes a feed, and
-- that is a promise made on the landing page and in SECURITY_AND_DATA.md.
-- Storing facts about a non-customer's revenue is a materially larger
-- commitment than storing an email, and the same information is available by
-- asking them on the call this table exists to enable.
--
-- The columns below are the enforcement. There is no free-text column and no
-- numeric column, so there is nowhere for a figure to be put later without a
-- migration that has to be argued for.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Lowercased before it arrives, so one person is one row however they typed
  -- it. Stored in the clear, unlike every identifier in the feed tables: this
  -- is a contact to be contacted, and a hash cannot be emailed.
  email text not null unique,

  -- Which box they typed into. Tells a very different story per source: the
  -- report is someone who saw their own numbers, the landing page is someone
  -- who read and did not start.
  source text not null,

  -- The furthest screen reached when they left the address, as a label rather
  -- than a number so a renamed step does not silently change history.
  furthest_step text,

  -- Salted hash, for rate limiting only. The salt is fixed rather than
  -- per-row because the point is to recognise the same caller twice, and a
  -- per-row salt would make that impossible.
  ip_hash text,

  created_at timestamptz not null default now(),
  -- Bumped when they come back and leave the same address further along.
  updated_at timestamptz not null default now(),

  -- Not a validator, a bound. Anything that gets past this is still checked in
  -- the route; what this stops is the column being used for something else.
  constraint leads_email_is_an_address check (
    email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and length(email) between 6 and 254
    and email = lower(email)
  ),
  constraint leads_source_known check (source in ('landing', 'report', 'flow')),
  constraint leads_step_is_a_label check (
    furthest_step is null or length(furthest_step) between 1 and 40
  ),
  constraint leads_ip_hash_is_sha256 check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.leads is
  'Email addresses left voluntarily, with where the person stopped. Never anything derived from their CRM file - no values, counts, ratios or segment names.';

comment on column public.leads.email is
  'In the clear, deliberately: this is a contact to be contacted. Deleting on request is a delete from this table and nothing else.';

comment on column public.leads.ip_hash is
  'Salted hash, for rate limiting. Counting recent rows for one hash is the limiter, so the limit and its audit trail are one fact.';

-- The churn list is read newest first, always.
create index if not exists leads_by_recency on public.leads (created_at desc);

-- The rate limiter's query: how many did this caller leave in the last hour.
create index if not exists leads_by_caller on public.leads (ip_hash, created_at desc);

alter table public.leads enable row level security;
