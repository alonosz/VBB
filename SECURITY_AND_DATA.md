# Security and data

What VBB stores, what it deliberately does not, and how the boundaries are
enforced. Written so it can be shown to a customer's security reviewer without
translation.

---

## The short version

**No CRM record is ever stored on our servers.** Not a name, not an email
address, not a job title, not an individual deal amount, not a line of free
text. A lead exists server-side as a hashed identifier, a timestamp, and a
number.

This is not a policy anyone has to remember. Database CHECK constraints make
the alternative impossible to store, and 39 assertions run against a real
Postgres to prove it.

---

## What is stored, table by table

| Table | Holds | Never holds |
|---|---|---|
| `workspaces` | Customer label, hashed key | Contact details |
| `feeds` | Hashed token, currency, model id | Anything about a lead |
| `feed_rows` | SHA-256 email **or** click ID, timestamp, value | Addresses, names, amounts |
| `feed_models` | Multipliers, level labels, aggregates | Any individual deal |
| `feed_fetches` | Timestamp, HTTP status, hashed IP | Raw IPs |
| `crm_connections` | AES-256-GCM encrypted tokens | Plaintext credentials |
| `sync_runs` | Counts, one-sentence outcome | Any lead, any value |

### The one place worth explaining

`feed_models` holds figures derived from deal amounts - each level's median won
amount, the base value, the outlier cap. These are **aggregates over at least
25 resolved deals**, never an individual deal, and the model cannot work
without them: they are what makes a multiplier explainable ("Manufacturing, 121
deals, 32.2% close, median 6,800") rather than a bare number a customer has to
take on faith.

Level labels are category names from the customer's own CRM - "Manufacturing",
"201–1,000". Never notes, never free text.

---

## Where the raw CRM data actually lives

**In the customer's browser, and nowhere else.**

The CSV is parsed, mapped, analysed and priced client-side. Only the finished
rows - hashed identifier, time, value - are posted to the server. The server
cannot recompute a value because it does not have the data to recompute it
from, which is the point: what Google receives is an artifact the customer
published, not something derived behind them.

During the nightly sync, CRM records exist in server memory for the length of
one run and are never written down.

Mid-flow the upload is kept in **session** storage so a refresh does not lose
the work. Session, not local: a raw CRM export has no business outliving the
browser tab it was opened in.

---

## Credentials

Four kinds, deliberately separated.

| | Given to | Can do | Stored as |
|---|---|---|---|
| **Feed token** | Google Ads | Read one CSV | SHA-256 hash |
| **Workspace key** | The customer | Publish, connect a CRM, read status | SHA-256 hash |
| **CRM token** | Us, by the customer | Read their deals | AES-256-GCM ciphertext |
| **Cron secret** | Vercel's scheduler | Trigger the nightly job | Environment only |

**The feed token cannot change anything.** It reads a CSV. It was briefly able
to do more - the CRM connect routes resolved a feed by its own token, meaning
anyone with a feed URL could attach their own HubSpot to someone else's feed.
That was found in the launch audit and closed: state-changing routes require
the workspace key, and then check the feed belongs to that workspace.

Tokens are never recoverable. Each is shown once and stored only as a hash, so
a database leak hands nobody a working credential.

---

## Isolation between customers

Every feed, model, connection and run belongs to a workspace by foreign key -
`client_id` is `NOT NULL` and enforced by the database, not by convention.

A valid workspace key pointed at another customer's feed gets exactly the same
answer as one pointed at a feed that does not exist, so a key cannot be used to
discover what exists.

Tested directly and verified by sabotage: removing the ownership check,
ignoring suspension, and distinguishing "someone else's" from "not found" all
cause tests to fail.

---

## Encryption at rest

CRM tokens are encrypted with AES-256-GCM under `VBB_TOKEN_KEY`, which lives in
the environment and never in the database. A dump of the tables is useless
without it.

Authenticated encryption, so a tampered value fails to decrypt rather than
quietly yielding a different token. Fresh IV per encryption. With no key
configured the store **refuses to write** rather than falling back to
plaintext, and a CHECK constraint refuses anything that is not ciphertext.

---

## Row-level security

Every table has RLS enabled with **no policies**. No anonymous or authenticated
Supabase client can read or write any of it. Only the service role, used
server-side, has access. There is no browser path to these tables by design.

---

## The one LLM call

Exactly one, at upload, proposing which column is which. It receives:

- Column **names**
- Value kinds, fill rates, cardinality, digit counts
- For short low-cardinality category columns only: a few example labels

It never receives emails, names, phone numbers, addresses, click IDs, deal
amounts (not even as a range), or free text. It never returns a value,
multiplier, score or close rate - every figure in the product comes from the
deterministic engine reading the customer's own rows.

Its output is untrusted: everything passes through a sanitiser that drops
columns not in the file, unknown field keys, duplicates and impossible numbers.

With no API key configured, the product runs unchanged on header matching.

---

## Outbound network

| To | What | When |
|---|---|---|
| Anthropic | Column profiles (above) | Once per upload |
| HubSpot | Read-only CRM queries | Nightly, per connected customer |
| The customer's own site | One page fetch to check the snippet | When they ask |

That last one is fenced against SSRF: protocol and credential checks, private
address-range rejection, DNS re-resolution, manual redirect following, and
size-capped reads.

**Nothing is ever written to a customer's CRM.** The HubSpot scopes requested
are read-only and there is no write path in the code.

---

## Known limitations for the pilot

Stated plainly rather than discovered later.

- **No user accounts.** A workspace key is a bearer credential: whoever holds
  it has access. Appropriate for five pilots with a named contact each; not for
  self-serve.
- **No per-customer volume limits.** The assisted-intake endpoint requires a
  workspace key, so it is not open to the internet, but a customer could call
  it repeatedly. Acceptable at five customers, not at fifty.
- **No audit log.** Who rotated a token and when is not recorded.
- **`/api/snippet/verify` is not rate-limited.** SSRF-fenced, but callable
  repeatedly.
- **Deleting a workspace is permanent** and takes its feeds, rows, models and
  connections with it. There is no undo and no soft delete.

---

## Deleting a customer's data

Deleting the workspace row removes everything by cascade - feeds, rows, models,
fetch log, CRM connection, run history.

The customer's own data was never on our servers to begin with; what is deleted
is the hashed identifiers, the values sent to Google, and the model.

Rows already delivered to their Google Ads account are theirs and are not ours
to remove.
