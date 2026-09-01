-- VBB Engine - how many of each night's leads Google can match.
--
-- The run history already answers "did it run" and "what went out". It cannot
-- answer the question that ends a pilot quietly: the site's click-ID capture
-- broke three weeks ago, every night since has run green, and every lead has
-- gone out unmatchable. Nothing in the existing columns moves when that
-- happens - the counts stay healthy, because pricing and publishing both
-- worked. Only the share of leads carrying an identifier moves.
--
-- Counts, not rows. This is the same shape as everything else in this table:
-- how many, never which. No lead, no click ID, no email, no URL.
--
-- Nullable on purpose. Runs recorded before this migration did not measure
-- coverage, and writing 0 for them would say every lead that week was
-- unmatchable, which is a fabricated number of the exact kind this product
-- exists to refuse. Null means not measured, and the screen says so.
alter table public.sync_runs
  add column if not exists leads_with_click_id integer,
  add column if not exists leads_with_email integer,
  add column if not exists leads_with_neither integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sync_runs_coverage_is_not_negative'
  ) then
    alter table public.sync_runs
      add constraint sync_runs_coverage_is_not_negative check (
        (leads_with_click_id is null or leads_with_click_id >= 0)
        and (leads_with_email is null or leads_with_email >= 0)
        and (leads_with_neither is null or leads_with_neither >= 0)
      );
  end if;
end $$;

comment on column public.sync_runs.leads_with_click_id is
  'Leads in this run carrying an ad click ID. Null on runs recorded before coverage was measured.';
comment on column public.sync_runs.leads_with_email is
  'Leads in this run carrying an email address. A lead with both is in both counts.';
comment on column public.sync_runs.leads_with_neither is
  'Leads Google has nothing to match on. These are the ones a broken capture script produces.';
