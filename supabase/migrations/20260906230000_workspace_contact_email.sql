-- VBB Engine - an address on a workspace that came into being by itself.
--
-- A workspace is minted silently for a new visitor at the first server call,
-- so nothing on screen ever mentions a key. That leaves two things missing:
-- the operator cannot tell one self-serve workspace from another, and the
-- visitor cannot get back in from a second device. Both are one address.
-- Left at the send step, on purpose, after they have something worth keeping.
--
-- Only the address. It is the advertiser's own contact, not a CRM record;
-- the feed tables stay the only place holding anything derived from their
-- data.

alter table public.workspaces
  add column if not exists contact_email text;

comment on column public.workspaces.contact_email is
  'Where to send the link that opens this workspace on another device. Null until the advertiser leaves one.';
