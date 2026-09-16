-- VBB Engine - when a workspace was last opened.
--
-- The admin page listed who had been invited and could not say who had ever
-- come back. For a product being handed to design partners one at a time,
-- that is the question the list exists to answer. One timestamp, touched by
-- the key check every authorised request goes through, and throttled so a
-- busy session costs one write rather than one per call.
--
-- A time, and nothing about what they did. The feed tables stay the only
-- place holding anything derived from an advertiser's data.

alter table public.workspaces
  add column if not exists last_seen_at timestamptz;

comment on column public.workspaces.last_seen_at is
  'When this workspace''s key was last presented and accepted. Null means never since the column existed.';
