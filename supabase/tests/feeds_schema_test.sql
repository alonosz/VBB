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

-- --- feed_models -----------------------------------------------------------

-- A model small enough to read, shaped exactly like a SavedValueModel.
select pg_temp.must_pass($$
  insert into public.feed_models (feed_id, model_id, format_version, currency_code, model)
  values (
    '11111111-1111-1111-1111-111111111111', 'model-1', 1, 'USD',
    '{"formatVersion":1,"modelId":"model-1","currencyCode":"USD","baseValue":1993.73,
      "calibrationFactor":0.613169,"cap":21150,
      "factors":[{"key":"industry","label":"Industry","levels":[
        {"level":"Manufacturing","multiplier":1.641,"sampleSize":121,
         "closeRate":0.322,"medianWonAmount":6800}]}]}'::jsonb
  )$$,
  'a well-formed saved model is stored');

select pg_temp.must_fail($$
  insert into public.feed_models (feed_id, model_id, format_version, currency_code, model)
  values (
    '11111111-1111-1111-1111-111111111111', 'model-2', 1, 'USD',
    '{"formatVersion":1,"modelId":"model-2","currencyCode":"USD","baseValue":1000,
      "factors":[{"key":"seniority","label":"Seniority","levels":[
        {"level":"dana.k@northridgefab.com","multiplier":1.2}]}]}'::jsonb
  )$$,
  'AN EMAIL ADDRESS SMUGGLED INTO A LEVEL LABEL CANNOT BE STORED');

select pg_temp.must_fail($$
  insert into public.feed_models (feed_id, model_id, format_version, currency_code, model)
  values (
    '11111111-1111-1111-1111-111111111111', 'model-3', 1, 'USD',
    '{"formatVersion":1,"modelId":"model-3","currencyCode":"USD","baseValue":0,
      "factors":[]}'::jsonb
  )$$,
  'a model with no base value is rejected — it would price every lead at zero');

select pg_temp.must_fail($$
  insert into public.feed_models (feed_id, model_id, format_version, currency_code, model)
  values (
    '11111111-1111-1111-1111-111111111111', 'model-4', 1, 'USD',
    '{"formatVersion":1,"modelId":"a-different-id","currencyCode":"USD",
      "baseValue":1000,"factors":[]}'::jsonb
  )$$,
  'a document whose modelId disagrees with its column is rejected');

select pg_temp.must_fail($$
  insert into public.feed_models (feed_id, model_id, format_version, currency_code, model)
  values (
    '11111111-1111-1111-1111-111111111111', 'model-5', 1, 'EUR',
    '{"formatVersion":1,"modelId":"model-5","currencyCode":"USD",
      "baseValue":1000,"factors":[]}'::jsonb
  )$$,
  'a model whose currency disagrees with its column is rejected');

do $$
declare kept text;
begin
  -- Republishing after a refit replaces the current model rather than
  -- accumulating one row per publish.
  insert into public.feed_models (feed_id, model_id, format_version, currency_code, model)
  values (
    '11111111-1111-1111-1111-111111111111', 'model-refit', 1, 'USD',
    '{"formatVersion":1,"modelId":"model-refit","currencyCode":"USD",
      "baseValue":2100,"factors":[]}'::jsonb
  )
  on conflict (feed_id) do update
    set model_id = excluded.model_id,
        model = excluded.model,
        updated_at = now();

  select model_id into kept from public.feed_models
   where feed_id = '11111111-1111-1111-1111-111111111111';
  if kept <> 'model-refit' then
    raise exception 'FAIL  a refit left % as the current model', kept;
  end if;
  raise notice 'PASS  a refit replaces the current model for a feed';
end;
$$;

-- --- crm_connections -------------------------------------------------------

select pg_temp.must_pass($$
  insert into public.crm_connections (feed_id, provider, access_token, refresh_token)
  values (
    '11111111-1111-1111-1111-111111111111', 'hubspot',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4',
    'v1.QQQQQQQQQQQQ.WWWWWWWWWWWWWWWW.ZWVlZWVlZWVlZQ'
  )$$,
  'an encrypted CRM token is stored');

select pg_temp.must_fail($$
  insert into public.crm_connections (feed_id, provider, access_token)
  values (
    '11111111-1111-1111-1111-111111111111', 'hubspot',
    'crm-token-placeholder-not-a-real-credential'
  )$$,
  'A PLAINTEXT CRM TOKEN CANNOT BE STORED');

select pg_temp.must_fail($$
  insert into public.crm_connections (feed_id, provider, access_token, refresh_token)
  values (
    '11111111-1111-1111-1111-111111111111', 'hubspot',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4',
    'refresh-token-in-the-clear'
  )$$,
  'a plaintext refresh token is rejected too');

select pg_temp.must_fail($$
  insert into public.crm_connections (feed_id, provider, access_token)
  values (
    '11111111-1111-1111-1111-111111111111', 'salesforce',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4'
  )$$,
  'a provider we have not built is rejected');

select pg_temp.must_fail($$
  update public.crm_connections
     set last_sync_error = repeat('x', 501)
   where feed_id = '11111111-1111-1111-1111-111111111111'$$,
  'an error field long enough to hold a stack trace is rejected');

select pg_temp.must_fail($$
  update public.crm_connections set last_sync_status = 'weird'
   where feed_id = '11111111-1111-1111-1111-111111111111'$$,
  'an unknown sync status is rejected');

-- --- cascade --------------------------------------------------------------

delete from public.feeds where id = '11111111-1111-1111-1111-111111111111';

do $$
declare leftover integer;
begin
  select (select count(*) from public.feed_rows)
       + (select count(*) from public.feed_fetches)
       + (select count(*) from public.feed_models)
       + (select count(*) from public.crm_connections)
    into leftover;
  if leftover <> 0 then
    raise exception 'FAIL  deleting a feed left % rows behind', leftover;
  end if;
  raise notice 'PASS  deleting a feed takes its rows, log, model and CRM connection with it';
end;
$$;

rollback;
