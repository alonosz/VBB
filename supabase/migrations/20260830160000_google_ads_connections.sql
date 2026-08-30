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
