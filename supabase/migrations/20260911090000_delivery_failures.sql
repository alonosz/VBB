-- A row Google refused on its own.
--
-- The Data Manager API accepts or rejects a request whole. One row Google
-- will never take - a click ID it does not recognise, a conversion older
-- than the action accepts - would otherwise sit in every later batch and
-- fail it, so nothing behind it ever reaches Google. A refused row is now
-- named as such: the live path skips it, the nightly run retries it, and
-- the workspace page can say why it is waiting.

alter table public.feed_rows
  add column if not exists delivery_failed_at timestamptz,
  add column if not exists delivery_error text;

alter table public.feed_rows
  drop constraint if exists feed_rows_delivery_error_is_short;
alter table public.feed_rows
  add constraint feed_rows_delivery_error_is_short
    check (delivery_error is null or length(delivery_error) <= 500);

comment on column public.feed_rows.delivery_failed_at is
  'When Google last refused this row on its own. Null once it is delivered. The live path skips a refused row; the nightly run tries it again.';
comment on column public.feed_rows.delivery_error is
  'What Google said when it refused the row, for the workspace page. Never a lead.';
