# Supabase — the feed tables

The server side of VBB holds one thing: the finished rows Google fetches.

No CRM records, no contact or company names, no deal amounts, no free text. A
lead reaches this database as a hashed email or an ad click ID, a timestamp,
and the value the advertiser approved sending — and nothing else. The value
cannot be recomputed here, because the data needed to recompute it never
arrives. That is deliberate: what Google receives is an artifact the advertiser
published, not something derived behind them.

The CHECK constraints are the privacy promise written down. An unhashed email
address is not merely discouraged in this schema, it is unstorable — in either
identifier column.

## Tables

| Table | Holds |
|---|---|
| `feeds` | One tokenized URL. The token is stored only as a SHA-256 hash, plus a prefix long enough to recognise it in a list and too short to use. |
| `feed_rows` | The Google Ads Click Conversion Import rows: hashed email or click ID, conversion time, value, currency, and the model that priced it. |
| `feed_fetches` | Every fetch attempt, with a hashed IP. Counting the last 24 hours *is* the rate limiter, so the limit and its audit trail are one fact. |

Row-level security is on with no policies, so no anon or authenticated client
can reach any of it. Only the service role, used server-side by the feed route,
has access. There is no browser path to these tables by design: the browser
holds the CRM data, the server holds only what Google gets, and neither needs
the other's half.

## Applying

Setting up a new project by hand: paste `supabase/setup.sql` into the Supabase
SQL Editor and run it. That file is every migration concatenated in order, so
it is one paste rather than one per migration. Regenerate it with
`./scripts/build-setup-sql.sh` after adding a migration.

With the Supabase CLI, against your project:

```bash
supabase db push
```

Or directly, against any Postgres:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/setup.sql
```

## Verifying

```bash
./scripts/db-test.sh                              # boots a throwaway local cluster
DATABASE_URL=postgres://… ./scripts/db-test.sh    # or checks an existing database
```

It applies every migration and then asserts each guarantee the schema claims —
including that an email address cannot be written to either identifier column.
Run it after any migration that touches these tables.

## The endpoints

`POST /api/feeds` publishes: the browser prices the leads, applies the emit
rules, and sends finished rows. The response carries the feed URL **once** —
the token exists afterwards only as a hash here and in the advertiser's
clipboard.

`GET /v1/feeds/google-ads?key=<token>` is what Google fetches. It authorizes by
hashing the presented token, rate limits to 10 fetches per 24 hours, logs every
attempt with a hashed IP, and answers a wrong token, a revoked feed and a
missing token identically — distinguishing them would confirm to a prober that
a token was once real.

Request handling lives in `src/lib/feed/handlers.ts`, separate from how the
repository is obtained, so the whole cycle is driven against an in-memory
repository in tests.

## Environment

```
NEXT_PUBLIC_SUPABASE_URL=      # or SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=     # or SUPABASE_SECRET_KEY
```

Supabase now calls the privileged key a **secret key** (`sb_secret_…`) where it
used to say `service_role`. They are the same thing here, and either variable
name is accepted — the publishable key (`sb_publishable_…`) will not work,
because row-level security is on with no policies.

The privileged key is server-only and must never be exposed to the browser.
With neither set, the diagnostic runs exactly as it does today and the feed
endpoint reports that it is not configured.
