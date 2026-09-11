-- Google rejects a Click Conversion Import whose columns don't match its
-- template, and a single file carries one identifier type. Which one a feed
-- uses is therefore a property of the feed, fixed when it is published, not
-- something to infer from the rows at fetch time.
alter table public.feeds
  add column if not exists identifier text not null default 'clickId';

alter table public.feeds
  drop constraint if exists feeds_identifier_known;

-- 'both' arrived in a later migration. Written here in its final form so the
-- one-paste setup file can be re-run against a database that already holds
-- feeds published with both columns: the older rule would refuse them.
alter table public.feeds
  add constraint feeds_identifier_known check (identifier in ('clickId', 'email', 'both'));

comment on column public.feeds.identifier is
  'Which column set the CSV uses. Fixed at publish so the file Google fetches always matches its template.';
