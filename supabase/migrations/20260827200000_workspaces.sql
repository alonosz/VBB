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
