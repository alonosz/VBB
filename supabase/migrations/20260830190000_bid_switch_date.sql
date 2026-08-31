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
