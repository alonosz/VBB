-- VBB Engine - a feed may carry both identifier columns.
--
-- The original assumption was that Google's Click Conversion Import takes one
-- identifier type per file, so a feed picked the column with the wider coverage
-- and threw the other away. That was wrong, and it cost leads: Google accepts a
-- Google Click ID column and an Email column in the same file, matches on the
-- click ID where there is one, and falls back to the email where the click ID
-- never survived - iOS, an ad blocker, a change of device. Sending both is its
-- own recommendation.
--
-- So `both` becomes the usual value. The two single-column sets stay, because
-- they are the honest answer for a file that only ever had one of them: a file
-- with no emails should not drag an advertiser through the enhanced conversions
-- setup for the sake of an empty column. Feeds published before today keep the
-- value they were published with and serve exactly the file they always did.

alter table public.feeds
  drop constraint if exists feeds_identifier_known;

alter table public.feeds
  add constraint feeds_identifier_known check (identifier in ('clickId', 'email', 'both'));

comment on column public.feeds.identifier is
  'Which identifier columns this feed''s CSV carries: clickId, email, or both. Fixed at publish - the columns are the file''s header row, so changing it mid-life would produce a file whose values no longer line up with its columns.';
