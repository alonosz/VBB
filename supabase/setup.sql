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

-- ============================================================
-- 20260826090000_feed_models.sql
-- ============================================================

-- VBB Engine — the saved model, stored server-side.
--
-- Until now the server could not price anything, and that was deliberate: the
-- browser held the CRM data and the server held only what Google gets. A
-- nightly sync breaks that symmetry, because a job that runs while nobody is
-- watching has to price leads with no browser in the loop.
--
-- What it stores is the artifact from src/lib/model/savedModel.ts — the frozen
-- rule stack, exactly as the advertiser approved it. Principle 8: a scheduled
-- run applies the saved model, it never refits one. A job that refit nightly
-- would reprice yesterday's leads every morning and Google would learn from a
-- moving target.
--
-- On the storage guardrail, stated plainly rather than buried: this is the
-- first table that holds figures derived from deal amounts — each level's
-- median won amount, the base value, the outlier cap. They are aggregates over
-- at least MIN_LEVEL_SAMPLE (25) resolved deals, never an individual deal, and
-- the model cannot function without them: they are what makes a multiplier
-- explainable ("Manufacturing, 121 deals, 32.2% close, median 6,800") instead
-- of a bare number. Level labels are category names from the advertiser's own
-- CRM — "Manufacturing", "201–1,000" — and never notes or free text.
--
-- What must never be here is a person: no addresses, no names, no titles as
-- typed. The check below enforces the first of those the same way the feed_rows
-- constraints do, because a promise the database will not refuse is not a
-- promise.

create table if not exists public.feed_models (
  -- One current model per feed. Republishing after a refit replaces it; the
  -- rows already sent keep the model_id that priced them, so lineage survives
  -- in the place it actually matters.
  feed_id uuid primary key references public.feeds (id) on delete cascade,

  model_id text not null,
  format_version integer not null,
  fitted_at timestamptz,
  currency_code text not null,

  -- The whole SavedValueModel. Kept as one document because it is validated as
  -- one on the way back in by loadSavedModel(), which treats it as untrusted
  -- input regardless of where it came from — a row in our own database is not
  -- more trustworthy than a file someone uploaded.
  model jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint feed_models_currency_is_iso check (currency_code ~ '^[A-Z]{3}$'),
  constraint feed_models_format_version_is_positive check (format_version > 0),

  -- The stored document has to agree with its own columns, or a lookup by
  -- model_id would find a model that prices under a different id.
  constraint feed_models_document_matches_columns check (
    model ->> 'modelId' = model_id
    and (model ->> 'formatVersion')::integer = format_version
    and model ->> 'currencyCode' = currency_code
  ),

  -- A model with no base value prices every lead at zero, which is worse than
  -- refusing to price at all: Google would learn that the advertiser's leads
  -- are worthless.
  constraint feed_models_has_a_base_value check (
    (model ->> 'baseValue')::numeric > 0
  ),

  -- The privacy line, enforced rather than remembered. An address always
  -- contains '@' and a category label never should. Same stance the feed_rows
  -- click_id constraint takes, and the same tradeoff: a legitimate label with
  -- an '@' in it is refused loudly, which is the failure we want.
  constraint feed_models_carries_no_addresses check (model::text !~ '@'),

  -- A saved model is a few kilobytes of multipliers. Anything approaching a
  -- megabyte is not a model, and is the shape a mistake takes.
  constraint feed_models_is_model_sized check (length(model::text) < 262144)
);

comment on table public.feed_models is
  'The frozen rule stack a scheduled run applies. Aggregates over >=25 deals only — never an individual deal, never a person.';

comment on column public.feed_models.model is
  'A SavedValueModel document. Revalidated by loadSavedModel() on read: our own row is untrusted input like any other.';

alter table public.feed_models enable row level security;

-- ============================================================
-- 20260827100000_crm_connections.sql
-- ============================================================

-- VBB Engine — CRM connections for the scheduled sync.
--
-- A refresh token is a different order of secret from anything else in this
-- schema. A feed row is a hashed identifier and a number; a CRM token is
-- standing read access to a customer's entire pipeline. Row-level security
-- protects it only while the database is not itself the thing that leaked.
--
-- So tokens arrive already encrypted, with a key that lives in the environment
-- and never in this database, and the CHECK below makes storing a plaintext
-- one impossible rather than merely discouraged. Encrypted values are
-- 'v1.<iv>.<tag>.<ciphertext>'; a HubSpot token never looks like that.
--
-- The connection is read-only in both directions: nothing here grants write
-- access to a CRM, and nothing about a CRM record is stored. A run borrows the
-- data in memory and writes only feed rows.

create table if not exists public.crm_connections (
  -- One connection per feed. The feed is the unit an advertiser owns and the
  -- sync runs against, so hanging the connection off it keeps the two from
  -- ever disagreeing about which portal priced which rows.
  feed_id uuid primary key references public.feeds (id) on delete cascade,

  provider text not null,
  -- Which portal, so a reconnection to a different account is visible rather
  -- than silently pulling someone else's deals into an existing feed.
  external_account_id text,

  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,

  -- The outcome of the last run, so a connection that quietly stopped working
  -- is visible without reading logs.
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_rows integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crm_connections_provider_known check (provider in ('hubspot')),

  constraint crm_connections_status_known check (
    last_sync_status is null or last_sync_status in ('ok', 'refused', 'failed')
  ),

  -- The promise, enforced. A credential for someone else's CRM is never
  -- written down in the clear, and the database is what guarantees it rather
  -- than everyone remembering to call the encrypt function.
  constraint crm_connections_access_token_is_encrypted check (
    access_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  ),
  constraint crm_connections_refresh_token_is_encrypted check (
    refresh_token is null
    or refresh_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  ),

  -- An error message is for a person to read, not a place to accumulate a
  -- stack trace or, worse, a fragment of CRM data.
  constraint crm_connections_error_is_a_sentence check (
    last_sync_error is null or length(last_sync_error) <= 500
  )
);

comment on table public.crm_connections is
  'Encrypted CRM credentials for the scheduled sync. Read-only access; no CRM record is ever stored here.';

comment on column public.crm_connections.access_token is
  'AES-256-GCM ciphertext. The CHECK constraint makes a plaintext token unstorable.';

alter table public.crm_connections enable row level security;

-- ============================================================
-- 20260827200000_workspaces.sql
-- ============================================================

-- VBB Engine — one workspace per customer.
--
-- Until now nothing tied a feed to anyone. feeds.client_id existed as a
-- nullable column and was never written, which was fine for one person testing
-- and is not fine the moment two customers exist: an operator cannot tell
-- whose feed is whose, and the only credential in the product — the feed token
-- — was doing two jobs at once.
--
-- That second problem was the sharper one. A feed URL is pasted into Google
-- Ads, sits in configuration screens and gets emailed around; it was designed
-- as a read credential. But /api/crm/hubspot/token resolved a feed by that
-- same token and then attached a CRM connection to it, so anyone holding a
-- customer's feed URL could point their own HubSpot at that customer's feed
-- and push a stranger's leads into their Google Ads account.
--
-- So the two are separated. The feed token reads the CSV and nothing else. The
-- workspace key — never shared with Google, never in a URL — is what authorises
-- publishing, connecting a CRM, and reading status.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),

  -- What the operator calls this customer. Not the customer's legal name and
  -- not a contact: a label for a list.
  name text not null,

  -- Hashed exactly like a feed token, and for the same reason: a database leak
  -- must not hand anyone a working key.
  key_hash text not null unique,
  key_prefix text not null,

  status text not null default 'active',
  created_at timestamptz not null default now(),
  suspended_at timestamptz,

  constraint workspaces_status_known check (status in ('active', 'suspended')),
  constraint workspaces_key_hash_is_sha256 check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint workspaces_suspended_has_timestamp check (
    (status = 'suspended') = (suspended_at is not null)
  ),
  -- A label, not a document. Long enough for "Northridge Fabrication (EU)".
  constraint workspaces_name_is_a_label check (length(name) between 1 and 120)
);

comment on table public.workspaces is
  'One customer. The key is stored only as a SHA-256 hash and is never given to Google.';

-- ---------------------------------------------------------------------------
-- Every feed now belongs to someone
-- ---------------------------------------------------------------------------

-- A feed with no owner cannot be listed, supported or isolated, so the column
-- stops being optional. Any feed predating this has no owner to infer and is
-- removed rather than guessed at — an orphan row that still serves a CSV to
-- Google is worse than no row.
delete from public.feeds where client_id is null;

alter table public.feeds
  alter column client_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feeds_client_is_a_workspace'
  ) then
    alter table public.feeds
      add constraint feeds_client_is_a_workspace
      foreign key (client_id) references public.workspaces (id) on delete cascade;
  end if;
end;
$$;

create index if not exists feeds_by_workspace
  on public.feeds (client_id, created_at desc);

comment on column public.feeds.client_id is
  'The workspace that owns this feed. Deleting a workspace takes its feeds, rows, models and CRM connections with it.';

alter table public.workspaces enable row level security;

