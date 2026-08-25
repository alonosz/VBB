-- Schema guarantees, checked against a real Postgres.
--
-- The privacy promise in this product is only worth what the database will
-- refuse to store. These assertions are that refusal, written down: run this
-- after any migration touching the feed tables.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- The assertions announce themselves through NOTICE, so keep notices on.
set client_min_messages to notice;

create or replace function pg_temp.must_fail(stmt text, what text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  %', what;
    return;
  end;
  raise exception 'FAIL  % — the database accepted it', what;
end;
$$;

create or replace function pg_temp.must_pass(stmt text, what text)
returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'PASS  %', what;
end;
$$;

begin;

-- A feed we can hang rows off. 64 hex chars, as a real token hash is.
insert into public.feeds (id, token_hash, token_prefix, model_id, currency_code)
values (
  '11111111-1111-1111-1111-111111111111',
  repeat('a', 64), 'vbb_live_8f2a', 'model-1', 'USD'
);

-- --- feeds ---------------------------------------------------------------

select pg_temp.must_fail($$
  insert into public.feeds (token_hash, token_prefix, model_id, currency_code)
  values ('not-a-hash', 'x', 'm', 'USD')$$,
  'a token_hash that is not SHA-256 is rejected');

select pg_temp.must_fail($$
  insert into public.feeds (token_hash, token_prefix, model_id, currency_code)
  values (repeat('b', 64), 'x', 'm', 'usd')$$,
  'a lowercase currency code is rejected');

select pg_temp.must_fail($$
  insert into public.feeds (token_hash, token_prefix, model_id, currency_code, status)
  values (repeat('c', 64), 'x', 'm', 'USD', 'revoked')$$,
  'a revoked feed with no revoked_at is rejected');

select pg_temp.must_fail($$
  insert into public.feeds (token_hash, token_prefix, model_id, currency_code)
  values (repeat('a', 64), 'x', 'm', 'USD')$$,
  'two feeds cannot share a token');

-- --- feed_rows: the privacy guard ----------------------------------------

select pg_temp.must_pass($$
  insert into public.feed_rows
    (feed_id, hashed_email, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111',
    'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976',
    '2026-05-01T09:07:05Z', 1200.00, 'USD', 'model-1', 'k1')$$,
  'a properly hashed email is stored');

select pg_temp.must_fail($$
  insert into public.feed_rows
    (feed_id, hashed_email, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111', 'alice@example.com',
    '2026-05-01T09:07:05Z', 1200.00, 'USD', 'model-1', 'k2')$$,
  'AN UNHASHED EMAIL ADDRESS CANNOT BE STORED');

select pg_temp.must_fail($$
  insert into public.feed_rows
    (feed_id, hashed_email, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111', 'abc123',
    '2026-05-01T09:07:05Z', 1200.00, 'USD', 'model-1', 'k3')$$,
  'a short non-hash in the email column is rejected');

select pg_temp.must_fail($$
  insert into public.feed_rows
    (feed_id, click_id, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111', 'someone@example.com',
    '2026-05-01T09:07:05Z', 1200.00, 'USD', 'model-1', 'k4')$$,
  'an email smuggled into the click ID column is rejected');

select pg_temp.must_fail($$
  insert into public.feed_rows
    (feed_id, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111',
    '2026-05-01T09:07:05Z', 1200.00, 'USD', 'model-1', 'k5')$$,
  'a row with no identifier at all is rejected');

select pg_temp.must_fail($$
  insert into public.feed_rows
    (feed_id, click_id, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111', 'Cj0KCQiAxxxxxxxx',
    '2026-05-01T09:07:05Z', 0, 'USD', 'model-1', 'k6')$$,
  'a zero value is rejected — never tell Google a lead was worthless');

-- --- feed_rows: republishing ---------------------------------------------

select pg_temp.must_fail($$
  insert into public.feed_rows
    (feed_id, hashed_email, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111',
    'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976',
    '2026-05-01T09:07:05Z', 1300.00, 'USD', 'model-1', 'k1')$$,
  'the same conversion cannot be sent twice');

select pg_temp.must_pass($$
  insert into public.feed_rows
    (feed_id, hashed_email, conversion_time, value, currency_code, model_id, row_key, kind)
  values ('11111111-1111-1111-1111-111111111111',
    'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976',
    '2026-05-01T09:07:05Z', 1900.00, 'USD', 'model-1', 'k1', 'adjustment')$$,
  'an adjustment to that same conversion is a separate row');

-- --- feed_fetches: the rate limiter is the log ---------------------------

select pg_temp.must_fail($$
  insert into public.feed_fetches (feed_id, status, ip_hash)
  values ('11111111-1111-1111-1111-111111111111', 200, '203.0.113.7')$$,
  'a raw IP address cannot be logged');

insert into public.feed_fetches (feed_id, status, row_count, fetched_at)
select '11111111-1111-1111-1111-111111111111', 200, 2, now() - (n || ' hours')::interval
from generate_series(1, 12) as n;

do $$
declare recent integer;
begin
  select count(*) into recent
  from public.feed_fetches
  where feed_id = '11111111-1111-1111-1111-111111111111'
    and fetched_at > now() - interval '24 hours';
  if recent <> 12 then
    raise exception 'FAIL  the 24h fetch window counted % instead of 12', recent;
  end if;
  raise notice 'PASS  the 24h window counts fetches for the rate limiter';
end;
$$;

-- --- cascade --------------------------------------------------------------

delete from public.feeds where id = '11111111-1111-1111-1111-111111111111';

do $$
declare leftover integer;
begin
  select (select count(*) from public.feed_rows)
       + (select count(*) from public.feed_fetches)
    into leftover;
  if leftover <> 0 then
    raise exception 'FAIL  deleting a feed left % rows behind', leftover;
  end if;
  raise notice 'PASS  revoking a feed takes its rows and its log with it';
end;
$$;

rollback;
