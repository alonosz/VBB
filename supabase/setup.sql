-- VBB Engine - one-paste setup for the Supabase SQL Editor.
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

-- VBB Engine - tokenized Google Ads feed.
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
-- feeds - one tokenized URL
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
-- feed_rows - exactly what Google fetches
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
  -- only ever written when the emit rules allowed it - a value change over 20%
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
  'The finished Google Ads conversion rows for a feed. Hashed identifiers only - CHECK constraints make an unhashed address unstorable.';

-- Republishing must not duplicate a conversion, but an adjustment to the same
-- conversion is a distinct row.
create unique index if not exists feed_rows_unique_per_feed
  on public.feed_rows (feed_id, row_key, kind);

create index if not exists feed_rows_by_feed
  on public.feed_rows (feed_id, conversion_time desc);

-- ---------------------------------------------------------------------------
-- feed_fetches - the log, which is also the rate limiter
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

-- VBB Engine - the saved model, stored server-side.
--
-- Until now the server could not price anything, and that was deliberate: the
-- browser held the CRM data and the server held only what Google gets. A
-- nightly sync breaks that symmetry, because a job that runs while nobody is
-- watching has to price leads with no browser in the loop.
--
-- What it stores is the artifact from src/lib/model/savedModel.ts - the frozen
-- rule stack, exactly as the advertiser approved it. Principle 8: a scheduled
-- run applies the saved model, it never refits one. A job that refit nightly
-- would reprice yesterday's leads every morning and Google would learn from a
-- moving target.
--
-- On the storage guardrail, stated plainly rather than buried: this is the
-- first table that holds figures derived from deal amounts - each level's
-- median won amount, the base value, the outlier cap. They are aggregates over
-- at least MIN_LEVEL_SAMPLE (25) resolved deals, never an individual deal, and
-- the model cannot function without them: they are what makes a multiplier
-- explainable ("Manufacturing, 121 deals, 32.2% close, median 6,800") instead
-- of a bare number. Level labels are category names from the advertiser's own
-- CRM - "Manufacturing", "201–1,000" - and never notes or free text.
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
  -- input regardless of where it came from - a row in our own database is not
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
  'The frozen rule stack a scheduled run applies. Aggregates over >=25 deals only - never an individual deal, never a person.';

comment on column public.feed_models.model is
  'A SavedValueModel document. Revalidated by loadSavedModel() on read: our own row is untrusted input like any other.';

alter table public.feed_models enable row level security;

-- ============================================================
-- 20260827100000_crm_connections.sql
-- ============================================================

-- VBB Engine - CRM connections for the scheduled sync.
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

-- VBB Engine - one workspace per customer.
--
-- Until now nothing tied a feed to anyone. feeds.client_id existed as a
-- nullable column and was never written, which was fine for one person testing
-- and is not fine the moment two customers exist: an operator cannot tell
-- whose feed is whose, and the only credential in the product - the feed token
-- - was doing two jobs at once.
--
-- That second problem was the sharper one. A feed URL is pasted into Google
-- Ads, sits in configuration screens and gets emailed around; it was designed
-- as a read credential. But /api/crm/hubspot/token resolved a feed by that
-- same token and then attached a CRM connection to it, so anyone holding a
-- customer's feed URL could point their own HubSpot at that customer's feed
-- and push a stranger's leads into their Google Ads account.
--
-- So the two are separated. The feed token reads the CSV and nothing else. The
-- workspace key - never shared with Google, never in a URL - is what authorises
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
-- removed rather than guessed at - an orphan row that still serves a CSV to
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

-- ============================================================
-- 20260828090000_sync_runs.sql
-- ============================================================

-- VBB Engine - what happened on each scheduled run.
--
-- The nightly job already recorded its outcome on the connection, which
-- answers "did the last run work" and nothing else. The failure that actually
-- ends a pilot is quieter than that: the cron stops firing. Vercel drops the
-- schedule, the secret rotates, a deploy removes it - and last_sync_at simply
-- stops moving. Nobody is watching a timestamp that does not change.
--
-- A run that happened leaves a row. A run that should have happened and did
-- not leaves a gap, and a gap is visible in a way a stale field is not: the
-- workspace page can say "the last run was three days ago" because it knows
-- what a normal night looks like.
--
-- The counts here are the ones an operator is asked about - how many leads
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
  -- A successful run that published nothing is normal - there may have been no
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

-- ============================================================
-- 20260828120000_workspace_invites.sql
-- ============================================================

-- VBB Engine - one-time links, so a customer never types a credential.
--
-- Until now the operator created a workspace, the key was displayed once, and
-- the customer pasted it by hand. Two problems with that. The key travelled
-- through whatever channel the operator used to send it, and if the customer
-- lost it there was no way back - the only recovery was a new workspace, which
-- orphans their feed and their saved model.
--
-- An invite fixes both. The operator sends a link; clicking it mints the key
-- in the customer's own browser. Nothing here stores a usable credential:
--
--   * the invite token is stored only as a SHA-256 hash, exactly like the
--     workspace key and the feed token;
--   * the workspace key is not stored at all, not even encrypted. Redeeming an
--     invite GENERATES a new one and replaces the hash on the workspace row.
--
-- That last property is what makes re-issue safe: "send them a new link" and
-- "rotate their key" are the same operation, so a lost key is a ten-second fix
-- instead of a dead workspace. It also means redeeming a new invite retires
-- the previous key, which is the correct behaviour for a credential someone
-- has just told you they can no longer find.

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,

  -- Hashed like every other credential in this schema. A database leak must
  -- not hand anyone a working link.
  token_hash text not null unique,

  created_at timestamptz not null default now(),

  -- Short-lived on purpose: a link that works forever is a password that was
  -- emailed, and this one rotates the workspace key when it is used.
  expires_at timestamptz not null,

  -- Single use. Set by a conditional update so two simultaneous clicks cannot
  -- both mint a key.
  redeemed_at timestamptz,

  constraint workspace_invites_token_is_sha256
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint workspace_invites_expires_after_creation
    check (expires_at > created_at)
);

create index if not exists workspace_invites_by_workspace
  on public.workspace_invites (workspace_id, created_at desc);

comment on table public.workspace_invites is
  'One-time links that mint a workspace key in the customer''s browser. Stored as a hash; carries no credential itself.';

comment on column public.workspace_invites.redeemed_at is
  'Set once, by a conditional update. A redeemed invite is spent and its link is inert.';

alter table public.workspace_invites enable row level security;

-- ============================================================
-- 20260828140000_connections_by_workspace.sql
-- ============================================================

-- VBB Engine - a CRM connection belongs to the customer, not to one feed.
--
-- Hanging the connection off a feed made sense while the only thing that read
-- a CRM was the nightly sync, which runs against a published feed. It stops
-- making sense the moment the *analysis* can read one too: a feed does not
-- exist until step 5, and connecting HubSpot is most useful at step 2, where
-- it replaces the CSV export that is the easiest thing in this product for a
-- human to get wrong.
--
-- A feed already belongs to a workspace, so moving the connection up one level
-- is a simplification rather than a workaround. One customer, one portal, used
-- by whatever needs it - the analysis while fitting a model, the sync while
-- refreshing a feed.

alter table public.crm_connections
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

-- Backfill from the feed each connection currently hangs off.
update public.crm_connections c
   set workspace_id = f.client_id
  from public.feeds f
 where f.id = c.feed_id
   and c.workspace_id is null;

-- A workspace with two connected feeds would collide on the new key. Keep the
-- one that synced most recently and drop the rest: they are the same portal
-- reconnected, and the freshest row is the one whose token is most likely to
-- still work. Nothing is lost that reconnecting would not restore.
delete from public.crm_connections c
 using public.crm_connections keep
 where c.workspace_id = keep.workspace_id
   and c.feed_id <> keep.feed_id
   and (
     coalesce(c.last_sync_at, c.created_at) < coalesce(keep.last_sync_at, keep.created_at)
     or (
       coalesce(c.last_sync_at, c.created_at) = coalesce(keep.last_sync_at, keep.created_at)
       and c.feed_id < keep.feed_id
     )
   );

-- Any row still without a workspace pointed at a feed that no longer exists.
-- An orphan holding an encrypted CRM token is worse than no row at all.
delete from public.crm_connections where workspace_id is null;

alter table public.crm_connections
  alter column workspace_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_connections_one_per_workspace'
  ) then
    alter table public.crm_connections
      add constraint crm_connections_one_per_workspace unique (workspace_id);
  end if;
end;
$$;

-- feed_id goes last, once nothing depends on it. Dropping the primary key
-- takes the old one-per-feed guarantee with it; the unique above replaces it.
alter table public.crm_connections
  drop constraint if exists crm_connections_pkey;

alter table public.crm_connections
  drop column if exists feed_id;

alter table public.crm_connections
  add primary key (workspace_id);

comment on table public.crm_connections is
  'One CRM portal per customer. Read by the analysis when fitting a model and by the nightly sync when refreshing a feed. Tokens are encrypted before they arrive here.';

comment on column public.crm_connections.workspace_id is
  'The customer this portal belongs to. Deleting the workspace takes the connection with it.';

-- ============================================================
-- 20260829120000_leads.sql
-- ============================================================

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

-- ============================================================
-- 20260830100000_self_serve_workspaces.sql
-- ============================================================

-- VBB Engine - a workspace can now come into existence without an operator.
--
-- Until now every workspace was created by hand at /admin and reached the
-- customer as an invite link. That is right for five pilots and wrong the
-- moment somebody clicks "Connect HubSpot" on step 2: the landing page
-- promises no account needed, and asking a marketer to paste a `vbb_ws_` key
-- is exactly the kind of technical errand this product exists not to hand out.
--
-- So a workspace can be minted silently. Nobody sees a credential: the key
-- goes straight into the browser that asked for it, and surfaces only later,
-- if they want their model on a second device, by which point they have
-- something worth keeping.
--
-- That makes creation reachable by anyone, which is what this column is for.
-- Counting recent rows for one caller *is* the rate limiter, the same shape
-- the feed fetch log and the leads table already use: the limit and its audit
-- trail are one fact rather than two that can disagree.

alter table public.workspaces
  add column if not exists created_ip_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspaces_created_ip_hash_is_sha256'
  ) then
    alter table public.workspaces
      add constraint workspaces_created_ip_hash_is_sha256
      check (created_ip_hash is null or created_ip_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

comment on column public.workspaces.created_ip_hash is
  'Salted hash of the caller that created a self-serve workspace, for rate limiting only. Null for the ones an operator made at /admin.';

-- The limiter's query: how many did this caller create in the last hour.
create index if not exists workspaces_by_creator
  on public.workspaces (created_ip_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- 20260830140000_feed_identifier_both.sql
-- ---------------------------------------------------------------------------

-- VBB Engine - a feed may carry both identifier columns.
--
-- The original assumption was that Google's Click Conversion Import takes one
-- identifier type per file, so a feed picked the column with the wider coverage
-- and threw the other away. That was wrong, and it cost leads: Google accepts a
-- Google Click ID column and an Email column in the same file, matches on the
-- click ID where there is one, and falls back to the email where the click ID
-- never survived - iOS, an ad blocker, a change of device. Sending both is its
-- own recommendation.
--
-- So `both` becomes the usual value. The two single-column sets stay, because
-- they are the honest answer for a file that only ever had one of them: a file
-- with no emails should not drag an advertiser through the enhanced conversions
-- setup for the sake of an empty column. Feeds published before today keep the
-- value they were published with and serve exactly the file they always did.

alter table public.feeds
  drop constraint if exists feeds_identifier_known;

alter table public.feeds
  add constraint feeds_identifier_known check (identifier in ('clickId', 'email', 'both'));

comment on column public.feeds.identifier is
  'Which identifier columns this feed''s CSV carries: clickId, email, or both. Fixed at publish - the columns are the file''s header row, so changing it mid-life would produce a file whose values no longer line up with its columns.';

-- ---------------------------------------------------------------------------
-- 20260830160000_google_ads_connections.sql
-- ---------------------------------------------------------------------------

-- VBB Engine - a workspace can hold an ad platform connection as well as a CRM.
--
-- Everything so far pushed values to Google by publishing a CSV and letting
-- Google fetch it. That works, and it is the only route that needs no approval
-- from anyone, so it stays. But it is a one-way shout into the dark: Google
-- reports nothing back, a refused fetch is indistinguishable from a dead URL,
-- and an advertiser can wire the whole thing correctly and still see nothing
-- because their campaigns are on a bid strategy that ignores conversion value.
-- None of that is visible without an API connection.
--
-- The credentials are the same shape as a CRM's: an OAuth token pair, per
-- workspace, that must never be written down in the clear. So they live in the
-- table that already refuses a plaintext token, rather than in a second table
-- carrying a second copy of the same CHECK constraints - which is how two
-- guarantees that were meant to be identical quietly stop being identical.
--
-- The table's name is now narrower than its contents. That is a rename worth
-- doing on a quiet day, not while the constraint it holds is the thing keeping
-- somebody's Google credentials encrypted.

-- One row per workspace *per provider*. Until now a workspace held one
-- connection, which is exactly the assumption that has to go: a customer needs
-- their CRM and their ads account connected at the same time, and the old
-- unique would have made the second one overwrite the first.
alter table public.crm_connections
  drop constraint if exists crm_connections_one_per_workspace;

alter table public.crm_connections
  drop constraint if exists crm_connections_pkey;

alter table public.crm_connections
  add primary key (workspace_id, provider);

alter table public.crm_connections
  drop constraint if exists crm_connections_provider_known;

alter table public.crm_connections
  add constraint crm_connections_provider_known
  check (provider in ('hubspot', 'google_ads'));

comment on table public.crm_connections is
  'Encrypted third-party OAuth credentials per workspace, one row per provider: CRMs we read deals from, and ad platforms we send values to. No CRM record and no campaign data is ever stored here.';

comment on column public.crm_connections.external_account_id is
  'Which account these credentials reach: a HubSpot portal id, or a Google Ads customer id. Stored so a reconnection to a different account is visible rather than silently pulling or pushing against the wrong one.';

-- ---------------------------------------------------------------------------
-- 20260830190000_bid_switch_date.sql
-- ---------------------------------------------------------------------------

-- VBB Engine - the day an advertiser switched to value-based bidding.
--
-- Without this one timestamp the product can never prove it worked. "Did it
-- work" compares the leads Google bought before the switch against the ones
-- after, and there is no "before" without knowing when before ended. It is
-- also the one fact that cannot be reconstructed later: three months from now
-- nobody remembers the date, and the comparison is gone for good.
--
-- Only the date is stored. The two cohorts are recomputed from the CRM window
-- each time rather than snapshotted, so nothing new about anybody's deals ends
-- up on the server - no counts, no amounts, no close rates. The feed tables
-- stay the only place holding anything derived from a customer's data.
--
-- Null is the normal state. It means either they have not switched yet or they
-- have not told us, and the screen says so plainly rather than guessing.

alter table public.workspaces
  add column if not exists value_bidding_switched_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspaces_switch_is_not_in_the_future'
  ) then
    -- A date in the future would put every lead in the "before" cohort and
    -- report a comparison against nothing. A day of slack absorbs a clock
    -- that disagrees with ours; anything beyond that is a mistake.
    alter table public.workspaces
      add constraint workspaces_switch_is_not_in_the_future
      check (
        value_bidding_switched_at is null
        or value_bidding_switched_at <= now() + interval '1 day'
      );
  end if;
end;
$$;

comment on column public.workspaces.value_bidding_switched_at is
  'When this advertiser moved their campaigns to a value-based bid strategy. The dividing line for the before/after comparison, and the only part of it that cannot be worked out later.';
