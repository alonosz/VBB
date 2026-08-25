-- VBB Engine — one-paste setup for the Supabase SQL Editor.
--
-- GENERATED FILE. Do not edit by hand: it is the migrations in
-- supabase/migrations/ concatenated in order, so that setting up a new project
-- is a single copy-paste instead of one per migration.
--
-- Regenerate with:  ./scripts/build-setup-sql.sh
--
-- The migrations remain the source of truth. If this file and they ever
-- disagree, they are right and this is stale.

-- ============================================================
-- 20260825120000_feeds.sql
-- ============================================================

-- VBB Engine — tokenized Google Ads feed.
--
-- What lives here is deliberately narrow: the finished rows Google will fetch,
-- and nothing else. No CRM records, no contact names, no company names, no deal
-- amounts, no free text. A lead reaches this schema only as a hashed email or
-- an ad click ID, a timestamp, and the value the advertiser approved sending.
--
-- The value cannot be recomputed here, because the data needed to recompute it
-- is not here. That is the point: what Google receives is an artifact the
-- advertiser published, not something derived behind them.

-- ---------------------------------------------------------------------------
-- feeds — one tokenized URL
-- ---------------------------------------------------------------------------

create table if not exists public.feeds (
  id uuid primary key default gen_random_uuid(),

  -- Carried from the start so multi-tenancy is a migration, not a rewrite.
  client_id uuid,

  -- The token itself is never stored. A fetch is authorized by hashing the
  -- presented token and looking for a match, so a database leak does not hand
  -- anyone a working feed URL.
  token_hash text not null unique,
  -- Enough to recognise a feed in a list ("vbb_live_8f2a…"), never enough to use it.
  token_prefix text not null,

  label text,

  -- Which saved model produced the rows, so a feed is always traceable to the
  -- rule stack that priced it.
  model_id text not null,
  model_fitted_at timestamptz,
  currency_code text not null,

  status text not null default 'active',
  created_at timestamptz not null default now(),
  published_at timestamptz,
  revoked_at timestamptz,
  rows_published integer not null default 0,

  constraint feeds_status_known check (status in ('active', 'revoked')),
  constraint feeds_currency_is_iso check (currency_code ~ '^[A-Z]{3}$'),
  constraint feeds_token_hash_is_sha256 check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint feeds_revoked_has_timestamp check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

comment on table public.feeds is
  'One tokenized Google Ads feed URL. The token is stored only as a SHA-256 hash.';

-- ---------------------------------------------------------------------------
-- feed_rows — exactly what Google fetches
-- ---------------------------------------------------------------------------

create table if not exists public.feed_rows (
  id bigserial primary key,
  feed_id uuid not null references public.feeds (id) on delete cascade,

  -- SHA-256 of the lowercased, trimmed email, per Google's Click Conversion
  -- Import spec. Never the address itself.
  hashed_email text,
  -- gclid / gbraid / wbraid, whichever the CRM carried.
  click_id text,

  -- Day-0: the moment the lead arrived, never the moment we processed it.
  conversion_time timestamptz not null,
  value numeric(14, 2) not null,
  currency_code text not null,
  model_id text not null,

  -- 'conversion' is a new lead. 'adjustment' restates one already sent, and is
  -- only ever written when the emit rules allowed it — a value change over 20%
  -- on a conversion under 7 days old. Google ignores anything later, so nothing
  -- later is written.
  kind text not null default 'conversion',

  -- Stable identity for one lead's conversion, so republishing a feed cannot
  -- send Google the same row twice.
  row_key text not null,

  created_at timestamptz not null default now(),

  constraint feed_rows_kind_known check (kind in ('conversion', 'adjustment')),
  constraint feed_rows_value_is_positive check (value > 0),
  constraint feed_rows_currency_is_iso check (currency_code ~ '^[A-Z]{3}$'),

  -- A row with no identifier can never be joined to a click, so it would be
  -- noise in Google's import and a row of data we had no reason to keep.
  constraint feed_rows_has_an_identifier check (
    hashed_email is not null or click_id is not null
  ),

  -- The privacy promise, enforced by the database rather than by remembering.
  -- A hashed email is 64 hex characters; an address never is, and an address
  -- always contains '@'.
  constraint feed_rows_email_is_hashed check (
    hashed_email is null or hashed_email ~ '^[0-9a-f]{64}$'
  ),
  constraint feed_rows_click_id_is_a_token check (
    click_id is null or (click_id !~ '@' and length(click_id) between 8 and 512)
  )
);

comment on table public.feed_rows is
  'The finished Google Ads conversion rows for a feed. Hashed identifiers only — CHECK constraints make an unhashed address unstorable.';

-- Republishing must not duplicate a conversion, but an adjustment to the same
-- conversion is a distinct row.
create unique index if not exists feed_rows_unique_per_feed
  on public.feed_rows (feed_id, row_key, kind);

create index if not exists feed_rows_by_feed
  on public.feed_rows (feed_id, conversion_time desc);

-- ---------------------------------------------------------------------------
-- feed_fetches — the log, which is also the rate limiter
-- ---------------------------------------------------------------------------

create table if not exists public.feed_fetches (
  id bigserial primary key,
  feed_id uuid not null references public.feeds (id) on delete cascade,
  fetched_at timestamptz not null default now(),

  -- What we answered with, so a run of 429s or 404s is visible as an anomaly.
  status integer not null,
  row_count integer not null default 0,
  user_agent text,
  -- Hashed for the same reason emails are: an IP identifies a person often
  -- enough to treat it as though it always does.
  ip_hash text,

  constraint feed_fetches_status_is_http check (status between 100 and 599),
  constraint feed_fetches_ip_is_hashed check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.feed_fetches is
  'Every fetch attempt. Counting rows in the last 24h is the rate limiter, so the limit and its audit trail are the same fact.';

-- The rate-limit query: fetches for this feed since a cutoff.
create index if not exists feed_fetches_by_feed_time
  on public.feed_fetches (feed_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Row-level security on with no policies means no anon or authenticated client
-- can read or write any of this. Only the service role, used by the feed route
-- on the server, reaches these tables. There is no browser path to them by
-- design: the browser holds the CRM data, the server holds only what Google
-- gets, and neither needs the other's half.
alter table public.feeds enable row level security;
alter table public.feed_rows enable row level security;
alter table public.feed_fetches enable row level security;

-- ============================================================
-- 20260825130000_feed_identifier.sql
-- ============================================================

-- Google rejects a Click Conversion Import whose columns don't match its
-- template, and a single file carries one identifier type. Which one a feed
-- uses is therefore a property of the feed, fixed when it is published, not
-- something to infer from the rows at fetch time.
alter table public.feeds
  add column if not exists identifier text not null default 'clickId';

alter table public.feeds
  drop constraint if exists feeds_identifier_known;

alter table public.feeds
  add constraint feeds_identifier_known check (identifier in ('clickId', 'email'));

comment on column public.feeds.identifier is
  'Which column set the CSV uses. Fixed at publish so the file Google fetches always matches its template.';

