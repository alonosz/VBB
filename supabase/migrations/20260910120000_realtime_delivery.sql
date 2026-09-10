-- Real-time delivery.
--
-- Until now a feed was one thing: a file Google fetches on its own schedule.
-- Values sent through the Google Ads connection were sent and forgotten -
-- no model stored, no record of which leads went - so nothing on the server
-- could price the next lead for that customer. A feed now says how it is
-- delivered, and rows on an API-delivered feed carry when they reached
-- Google, so a lead priced at three in the afternoon goes out at three in
-- the afternoon and a send Google refused is tried again by the nightly run
-- rather than lost.

alter table public.feeds
  add column if not exists delivery text not null default 'url';

alter table public.feeds
  drop constraint if exists feeds_delivery_known;
alter table public.feeds
  add constraint feeds_delivery_known check (delivery in ('url', 'api'));

comment on column public.feeds.delivery is
  'url: Google fetches the CSV at the feed URL. api: we send rows through the Data Manager API as they are priced, and delivered_at on each row says when.';

alter table public.feed_rows
  add column if not exists delivered_at timestamptz;

comment on column public.feed_rows.delivered_at is
  'When this row reached Google through the API. Null on a URL feed, and on an API feed until the send succeeds; the nightly run resends what is still null.';

-- What the delivery sweep reads: the rows of one feed still waiting.
create index if not exists feed_rows_pending_delivery
  on public.feed_rows (feed_id)
  where delivered_at is null;

-- A webhook names the portal, not the workspace. This is how the one becomes
-- the other.
create index if not exists crm_connections_by_external_account
  on public.crm_connections (provider, external_account_id);
