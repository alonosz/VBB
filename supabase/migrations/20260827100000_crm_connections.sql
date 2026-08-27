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
