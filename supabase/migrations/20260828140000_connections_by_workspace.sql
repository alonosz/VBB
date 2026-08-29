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
