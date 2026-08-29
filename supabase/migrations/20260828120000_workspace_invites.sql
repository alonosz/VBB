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
