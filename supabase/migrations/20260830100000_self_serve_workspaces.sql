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
