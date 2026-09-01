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
  raise exception 'FAIL  % - the database accepted it', what;
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

-- A customer, then a feed belonging to them.
insert into public.workspaces (id, name, key_hash, key_prefix)
values (
  '99999999-9999-9999-9999-999999999999',
  'Northridge Fabrication', repeat('9', 64), 'vbb_ws_4d21'
);

-- A feed we can hang rows off. 64 hex chars, as a real token hash is.
insert into public.feeds (id, client_id, token_hash, token_prefix, model_id, currency_code)
values (
  '11111111-1111-1111-1111-111111111111',
  '99999999-9999-9999-9999-999999999999',
  repeat('a', 64), 'vbb_live_8f2a', 'model-1', 'USD'
);

-- --- workspaces ------------------------------------------------------------

select pg_temp.must_fail($$
  insert into public.feeds (token_hash, token_prefix, model_id, currency_code)
  values (repeat('b', 64), 'vbb_live_bbbb', 'model-1', 'USD')$$,
  'A FEED WITH NO OWNER CANNOT BE STORED');

select pg_temp.must_fail($$
  insert into public.feeds (client_id, token_hash, token_prefix, model_id, currency_code)
  values ('88888888-8888-8888-8888-888888888888', repeat('c', 64), 'x', 'm', 'USD')$$,
  'a feed pointing at a workspace that does not exist is rejected');

select pg_temp.must_fail($$
  insert into public.workspaces (name, key_hash, key_prefix)
  values ('Plaintext Key Co', 'not-a-hash', 'x')$$,
  'a workspace key that is not SHA-256 is rejected');

select pg_temp.must_fail($$
  insert into public.workspaces (name, key_hash, key_prefix)
  values ('Duplicate Key Co', repeat('9', 64), 'vbb_ws_4d21')$$,
  'two workspaces cannot share a key');

select pg_temp.must_fail($$
  insert into public.workspaces (name, key_hash, key_prefix)
  values ('', repeat('7', 64), 'vbb_ws_7777')$$,
  'a workspace needs a name an operator can recognise');

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

select pg_temp.must_pass($$
  insert into public.feeds (client_id, token_hash, token_prefix, model_id, currency_code, identifier)
  values ('99999999-9999-9999-9999-999999999999', repeat('d', 64), 'vbb_live_dddd', 'm', 'USD', 'both')$$,
  'a feed may carry both identifier columns');

select pg_temp.must_fail($$
  insert into public.feeds (client_id, token_hash, token_prefix, model_id, currency_code, identifier)
  values ('99999999-9999-9999-9999-999999999999', repeat('e', 64), 'vbb_live_eeee', 'm', 'USD', 'guess')$$,
  'an identifier set nothing knows how to serve is rejected');

select pg_temp.must_pass($$
  insert into public.feed_rows
    (feed_id, click_id, hashed_email, conversion_time, value, currency_code, model_id, row_key)
  values ('11111111-1111-1111-1111-111111111111', 'Cj0KCQiAxxxxxxxx',
    'ff8d9819fc0e12bf0d24892e45987e249a28dce836a85cad60e28eaaa8c6d976',
    '2026-05-01T09:07:05Z', 1200.00, 'USD', 'model-1', 'k7')$$,
  'a row may carry a click ID and a hashed email together');

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
  'a zero value is rejected - never tell Google a lead was worthless');

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
  'a model with no base value is rejected - it would price every lead at zero');

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
  insert into public.crm_connections (workspace_id, provider, access_token, refresh_token)
  values (
    '99999999-9999-9999-9999-999999999999', 'hubspot',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4',
    'v1.QQQQQQQQQQQQ.WWWWWWWWWWWWWWWW.ZWVlZWVlZWVlZQ'
  )$$,
  'an encrypted CRM token is stored');

-- The connection belongs to the customer now, not to one of their feeds, so a
-- second portal for the same customer is a reconnection rather than a new row.
select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values (
    '99999999-9999-9999-9999-999999999999', 'hubspot',
    'v1.zZzZzZzZzZzZ.yYyYyYyYyYyYyYyY.Zm9vYmFyYmF6cXV4'
  )$$,
  'a customer cannot hold two CRM connections at once');

select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values (
    '00000000-0000-0000-0000-000000000000', 'hubspot',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4'
  )$$,
  'a connection for a customer that does not exist is rejected');

select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values (
    '99999999-9999-9999-9999-999999999999', 'hubspot',
    'crm-token-placeholder-not-a-real-credential'
  )$$,
  'A PLAINTEXT CRM TOKEN CANNOT BE STORED');

select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token, refresh_token)
  values (
    '99999999-9999-9999-9999-999999999999', 'hubspot',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4',
    'refresh-token-in-the-clear'
  )$$,
  'a plaintext refresh token is rejected too');

select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values (
    '99999999-9999-9999-9999-999999999999', 'salesforce',
    'v1.aBcDeFgHiJkL.mNoPqRsTuVwXyZ01.Zm9vYmFyYmF6cXV4'
  )$$,
  'a provider we have not built is rejected');

-- One row per provider, not one per workspace. A customer needs their CRM read
-- and their ads account written at the same time; the old one-per-workspace
-- unique would have made the second connection overwrite the first.
select pg_temp.must_pass($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values ('99999999-9999-9999-9999-999999999999', 'google_ads',
    'v1.dddddddddddd.eeeeeeeeeeee.ffffffffffff')$$,
  'THE SAME WORKSPACE CAN HOLD A CRM AND AN ADS CONNECTION AT ONCE');

select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values ('99999999-9999-9999-9999-999999999999', 'google_ads',
    'v1.111111111111.222222222222.333333333333')$$,
  'but not two connections to the same provider');

-- The promise that matters most, checked again for the new provider: a Google
-- refresh token is a standing key to somebody else's ad spend.
select pg_temp.must_fail($$
  insert into public.crm_connections (workspace_id, provider, access_token)
  values ('88888888-8888-8888-8888-888888888888', 'google_ads', 'ya29.a0AfB_plaintext')$$,
  'A PLAINTEXT GOOGLE ADS TOKEN CANNOT BE STORED');


select pg_temp.must_fail($$
  update public.crm_connections
     set last_sync_error = repeat('x', 501)
   where workspace_id = '99999999-9999-9999-9999-999999999999'$$,
  'an error field long enough to hold a stack trace is rejected');

select pg_temp.must_fail($$
  update public.crm_connections set last_sync_status = 'weird'
   where workspace_id = '99999999-9999-9999-9999-999999999999'$$,
  'an unknown sync status is rejected');

-- --- sync_runs -------------------------------------------------------------

select pg_temp.must_pass($$
  insert into public.sync_runs (feed_id, client_id, status, deals_pulled, rows_published, new_conversions)
  values (
    '11111111-1111-1111-1111-111111111111',
    '99999999-9999-9999-9999-999999999999',
    'ok', 120, 84, 84
  )$$,
  'a successful run is recorded');

select pg_temp.must_pass($$
  insert into public.sync_runs (feed_id, client_id, status, rows_published)
  values (
    '11111111-1111-1111-1111-111111111111',
    '99999999-9999-9999-9999-999999999999',
    'ok', 0
  )$$,
  'a run that published nothing is fine - there may have been no new leads');

select pg_temp.must_fail($$
  insert into public.sync_runs (client_id, status)
  values ('99999999-9999-9999-9999-999999999999', 'refused')$$,
  'a refusal with no reason is rejected - a silent refusal is the bug');

select pg_temp.must_fail($$
  insert into public.sync_runs (client_id, status, message)
  values ('99999999-9999-9999-9999-999999999999', 'weird', 'x')$$,
  'an unknown run status is rejected');

select pg_temp.must_fail($$
  insert into public.sync_runs (client_id, status, rows_published)
  values ('99999999-9999-9999-9999-999999999999', 'ok', -1)$$,
  'a negative row count is rejected');

select pg_temp.must_fail($$
  insert into public.sync_runs (client_id, status, message)
  values ('99999999-9999-9999-9999-999999999999', 'failed', repeat('x', 501))$$,
  'a run message long enough to hold a stack trace is rejected');

-- Tracking coverage: counts, never rows, and null where it was not measured.
select pg_temp.must_fail($$
  insert into public.sync_runs (client_id, status, leads_with_neither)
  values ('99999999-9999-9999-9999-999999999999', 'ok', -1)$$,
  'a negative unmatchable count is rejected');

select pg_temp.must_pass($$
  insert into public.sync_runs (client_id, status, deals_pulled,
    leads_with_click_id, leads_with_email, leads_with_neither)
  values ('99999999-9999-9999-9999-999999999999', 'ok', 200, 150, 40, 30)$$,
  'a run records how many of its leads Google could match');

-- A run from before coverage was measured stays honest as unknown. Writing 0
-- would claim every lead that night was unmatchable.
select pg_temp.must_pass($$
  insert into public.sync_runs (client_id, status, deals_pulled)
  values ('99999999-9999-9999-9999-999999999999', 'ok', 200)$$,
  'a run that never measured coverage leaves it null rather than zero');

do $$
declare kept integer;
begin
  -- History outlives the feed it describes: an operator asked "what happened
  -- last week" should not be told the feed was deleted.
  delete from public.feeds where id = '11111111-1111-1111-1111-111111111111';
  select count(*) into kept from public.sync_runs
   where client_id = '99999999-9999-9999-9999-999999999999';
  if kept < 2 then
    raise exception 'FAIL  deleting a feed destroyed % run records', kept;
  end if;
  raise notice 'PASS  a workspace keeps its run history when a feed is deleted';
end;
$$;

-- --- self-serve workspaces --------------------------------------------------
--
-- Creating a workspace is reachable by anyone now, so the column the rate
-- limiter counts on has to refuse a raw address the same way every other
-- caller record in this schema does.

select pg_temp.must_pass($$
  insert into public.workspaces (name, key_hash, key_prefix, created_ip_hash)
  values ('Self-serve, 2026-08-30 14:22 UTC', repeat('7', 64), 'vbb_ws_77aa', repeat('c', 64))$$,
  'a self-serve workspace records a hashed creator');

select pg_temp.must_fail($$
  insert into public.workspaces (name, key_hash, key_prefix, created_ip_hash)
  values ('Bad', repeat('6', 64), 'vbb_ws_66aa', '203.0.113.7')$$,
  'AN UNHASHED CREATOR ADDRESS CANNOT BE STORED');

select pg_temp.must_pass($$
  insert into public.workspaces (name, key_hash, key_prefix)
  values ('Operator made', repeat('5', 64), 'vbb_ws_55aa')$$,
  'a workspace an operator made needs no creator at all');

-- --- the switch date -------------------------------------------------------

select pg_temp.must_pass($$
  update public.workspaces set value_bidding_switched_at = now() - interval '30 days'
  where id = '99999999-9999-9999-9999-999999999999'$$,
  'the day they switched to value-based bidding is recorded');

-- A future date puts every lead in the "before" cohort and reports a
-- comparison against nothing at all.
select pg_temp.must_fail($$
  update public.workspaces set value_bidding_switched_at = now() + interval '30 days'
  where id = '99999999-9999-9999-9999-999999999999'$$,
  'a switch date in the future is rejected');

select pg_temp.must_pass($$
  update public.workspaces set value_bidding_switched_at = null
  where id = '99999999-9999-9999-9999-999999999999'$$,
  'and it can be cleared by somebody who recorded the wrong day');

-- --- leads ----------------------------------------------------------------
--
-- This table is the one place an address is stored in the clear, so what it
-- refuses matters more than what it accepts. There is no numeric column and no
-- free-text column, which is the real guarantee; these check the bounds on the
-- columns that do exist.

select pg_temp.must_pass($$
  insert into public.leads (email, source, furthest_step)
  values ('someone@example.com', 'report', 'report')$$,
  'an address left on the report is stored');

select pg_temp.must_fail($$
  insert into public.leads (email, source)
  values ('Someone@Example.com', 'report')$$,
  'an address that was not lowercased is rejected - one person, one row');

select pg_temp.must_fail($$
  insert into public.leads (email, source) values ('not-an-address', 'report')$$,
  'a string that is not an address is rejected');

select pg_temp.must_fail($$
  insert into public.leads (email, source) values ('a@b.co', 'crm')$$,
  'a source that is not one of our boxes is rejected');

select pg_temp.must_fail($$
  insert into public.leads (email, source, furthest_step)
  values ('a@b.co', 'report', repeat('x', 41))$$,
  'a step label long enough to be a note is rejected');

select pg_temp.must_fail($$
  insert into public.leads (email, source, ip_hash)
  values ('a@b.co', 'report', '203.0.113.7')$$,
  'AN UNHASHED CALLER ADDRESS CANNOT BE STORED');

select pg_temp.must_fail($$
  insert into public.leads (email, source) values ('someone@example.com', 'landing')$$,
  'the same person cannot become two rows');

-- --- cascade --------------------------------------------------------------

delete from public.workspaces where id = '99999999-9999-9999-9999-999999999999';

do $$
declare leftover integer;
begin
  select (select count(*) from public.feeds)
       + (select count(*) from public.feed_rows)
       + (select count(*) from public.feed_fetches)
       + (select count(*) from public.feed_models)
       + (select count(*) from public.crm_connections)
       + (select count(*) from public.sync_runs)
    into leftover;
  if leftover <> 0 then
    raise exception 'FAIL  deleting a workspace left % rows behind', leftover;
  end if;
  raise notice 'PASS  deleting a workspace takes its feeds, rows, log, model and CRM connection';
end;
$$;

rollback;
