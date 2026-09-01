# Connecting Google Ads by API

The feed route (publish a CSV, Google fetches it) is not going anywhere. It
needs nobody's approval, it is the only path that works without a developer
token, and it is what the no-account-needed promise rests on.

This is the other route, and it is better for the reasons the feed cannot fix:
Google reports nothing back through a feed. A refused fetch and a dead URL look
identical, a rejected row is never reported to anyone, and an advertiser can
wire everything correctly and see no change because their campaigns are on a
bid strategy that ignores conversion value. The API answers per row, and lets
us read the campaign settings that decide whether any of it mattered.

State as of 30 August 2026.

---

## The Data Manager migration: what is built and what is still missing

`src/lib/sync/google/dataManager.ts` maps a FeedRow to an
`IngestEventsRequest`, from the field-mappings table. Tested, not yet wired,
because two constants are not knowable from that page:

- **The HTTP host and endpoint path** for ingesting events.
- **The OAuth scope.** Explicitly not the Ads API's `adwords` scope - the docs
  say new credentials are needed - so `SCOPES` in `google/oauth.ts` gains one
  and every existing connection has to re-consent.

Both live on **Set up API access** and **Send events**. Neither is guessable
and both are one line each.

### What the migration changes beyond the transport

- **No developer token.** The header goes; the account information it carried
  moves inside the destination.
- **Fast-fail, not partial failure.** One bad row rejects the whole request.
  `readPartialFailures()` and its map-back-by-index have no equivalent.
- **Asynchronous.** The response is a request id, not an accepted count.
  Results arrive via diagnostics.
- **Numeric conversion action id**, not a resource name.
- **operating_account must own the conversion action**, where the Ads API
  accepted any parent or descendant.
- **RFC 3339 timestamps**, not `2026-04-01 13:05:00+00:00`.

### The copy this makes false

The connect screen promises to "tell you exactly which rows Google took".
Under fast-fail and asynchronous processing that is no longer true, and it
has to change with the transport rather than after somebody notices.

### Adjustments

The field mappings cover `UploadClickConversionRequest` only. Whether
`ConversionAdjustmentUploadService` has a Data Manager equivalent, and what a
restatement looks like there, is not answered by that page and is still open.

## Blocked: UploadClickConversions is closed to new integrations

1 Sept 2026, first real upload. Google created the conversion action exactly
as specified, read the campaigns, and then refused all 466 rows:

> New integrations for uploading click conversions should use the Data Manager
> API. Usage of ConversionUploadService.UploadClickConversions is limited to
> existing users. Please see
> https://developers.google.com/data-manager/api/devguides/events/google-ads/offline

Verified against the trade press on 1 Sept 2026, because the refusal was
surprising enough to be worth checking rather than believing:

- The cutoff was **15 June 2026**. After it, the Google Ads API accepts no new
  adopters of offline conversion import, enhanced conversions for leads
  included.
- The allowlist is developers who **actively used the service between December
  2025 and May 2026**. It is grandfathering, not an application.
- Non-allowlisted callers get `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`, or
  the friendlier wording we saw.

This developer token was approved for Basic Access on 31 August 2026 and made
its first call that night. There was never a qualifying window to be inside.
No configuration change reaches this; it is not ours to fix.

Worth naming the commercial shape of it: every competitor who shipped before
June is grandfathered in, and every new entrant now starts on the Data
Manager API. That is a barrier we are on the wrong side of and they are not.
It is also temporary - the Data Manager API is open to everyone - and it is
exactly why the file route was kept as a first-class way in rather than a
fallback.

So the upload path in `src/lib/sync/google/upload.ts` is written against a
service this project is not allowed to call. Everything either side of it
works: OAuth, the stored connection, the developer token, v22, the conversion
action, the campaign audit.

**Not urgent, because nothing depends on it.** The CSV feed reaches Google with
no API access at all and is untouched by this. The API route was always the
nicer half - per-row errors, no setup wizard - not the only way in.

**What the migration needs, before any of it is written:** the Data Manager
API's host, version, endpoint, auth (whether the Google Ads developer token
header still applies), and the event payload shape - destination account,
conversion action, value, currency, timestamp, and the user identifiers
(gclid, hashed email). The doc URL above is the source. It was not readable
from the build sandbox, so nobody should infer the shape from the old service:
guessing an API shape is how a day disappears.

The identifier and value logic is already provider-neutral and does not move.
What changes is the transport in `upload.ts` and its fake.

## The API version is a live dependency, not a constant

Found on 31 Aug 2026, on the first call this code ever made to real Google.
Every request returned:

    Google Ads refused the request (HTTP 404).

Nothing was wrong with the connection. The OAuth handshake, the stored
credentials and the developer token were all fine. `v21` had been sunset, and
Google answers a retired version with a bare 404 and no body explaining it -
which reads exactly like a missing account.

**How to find the live version.** Request any endpoint with no credentials.
A version that exists answers 401; a retired one answers 404:

    for v in v20 v21 v22 v23; do
      curl -s -o /dev/null -w "$v -> %{http_code}\n" \
        "https://googleads.googleapis.com/$v/customers:listAccessibleCustomers"
    done

On that date v16 through v21 were all 404 and v22 answered 401.

**When it happens again**, and it will roughly quarterly: set
`GOOGLE_ADS_API_VERSION` in Vercel to the current version and redeploy. No
code change. The default in `client.ts` should be moved along at the same
time so a fresh deployment is not born broken.

The 404 message now says all of this on screen rather than leaving the next
person to work it out.

## What exists

| Thing | Value |
|---|---|
| Google Cloud project | `valuebasedbidding`, in org `bettersignals.co` |
| OAuth client | `977750247408-8e1mu98tib0b5trip2s7l2j70u9ocsl6.apps.googleusercontent.com` |
| Manager account (MCC) | `147-344-9095` |
| Empty account for testing | `830-411-0492` |
| Developer token | Test access. Basic applied for 30 Aug, ~5 business days |
| Consent screen | Configured, unverified, in Testing mode |

Redirect URIs registered on the OAuth client:

    https://vbb-cyan.vercel.app/api/ads/google/callback
    http://localhost:3000/api/ads/google/callback

Add `https://valuebasedbidding.com/api/ads/google/callback` when the custom
domain goes live. Do not remove the old ones. Our code builds the callback from
`feedOrigin()`, so it starts sending the new one the moment `VBB_PUBLIC_ORIGIN`
is set, and listing all of them is what makes that switch cost nothing.

## Settings

    GOOGLE_ADS_CLIENT_ID
    GOOGLE_ADS_CLIENT_SECRET
    GOOGLE_ADS_DEVELOPER_TOKEN
    GOOGLE_ADS_LOGIN_CUSTOMER_ID    optional, only when acting through a manager
    GOOGLE_ADS_API_VERSION          optional, overrides the pinned version

With none of them set the product runs exactly as it did: the feed route is
untouched, and the connect button reports that it is not configured on this
deployment rather than failing halfway.

---

## The three access levels, and why the middle one matters

| Level | Reaches |
|---|---|
| Test | Test accounts only. Every call against a real account is refused. |
| Basic | Real accounts, with a daily operation cap. |
| Standard | Real accounts, higher limits. |

A **test-access token cannot touch a production account**, including an empty
one. That is the whole reason Basic access is on the critical path, and it is
reviewed by a person.

### On test accounts

A Google Ads test account is a separate thing from an empty real account, and
creating one is not where the interface suggests. Two wrong turns already
found: **Create new account** under a manager opens the campaign-creation
wizard, which ends in a live campaign wanting a budget; and there is no obvious
test toggle anywhere in that flow.

We chose not to chase it. `830-411-0492` is a real account with no campaigns,
no spend and no billing, so the day Basic access lands it is a safe target with
no extra setup. Revisit test accounts only if Basic access is refused, and read
Google's own `best-practices/test-accounts` page first rather than trusting
this paragraph.

---

## Two things that will bite

**No refresh token means the connection dies in an hour.** Google only returns
one when the authorize URL carries `access_type=offline` *and* `prompt=consent`.
Miss the first and there is never a refresh token. Miss the second and there is
one for the first customer who ever approves the app and none for anybody
after, which hides the bug until it is somebody else's problem. Both are set in
`src/lib/sync/google/oauth.ts`, and the callback refuses a token set without a
refresh token rather than storing one that is about to stop working.

**Google does not rotate refresh tokens; HubSpot does.** Google returns no
refresh token when renewing and expects you to keep the one you have. HubSpot
returns a new one and expects you to save it. Treat either like the other and
the connection works for exactly one hour and then dies. `refreshedTokenSet()`
is that rule written once.

**While the consent screen is unverified**, the app is in Testing mode: only
listed test users can connect, and Google expires refresh tokens after about
seven days. A connection breaking after a week is Google's behaviour, not our
bug. It stops when the app is verified, which is a separate review from the
developer token.

---

## What the API does on a customer's behalf

Everything is against an account the advertiser authorised, with their own
credentials. Nothing touches campaigns, budgets, bids, keywords or audiences.

| Service | Access | Why |
|---|---|---|
| `CustomerService.ListAccessibleCustomers` | read | So they pick their account from a named list rather than typing ten digits |
| `GoogleAdsService.Search` (customer) | read | Name and currency. A currency that disagrees with the fitted model is refused rather than uploading values in the wrong units |
| `ConversionActionService` | write | Create one action, "VBB Lead Value", configured so value varies per conversion. This is what removes Google's six-step wizard from the customer's job |
| `ConversionUploadService` | write | The values, keyed on GCLID and hashed email, with `partial_failure` on so per-row errors are reported rather than swallowed |
| `ConversionAdjustmentUploadService` | write | Restate a value inside Google's seven days when a lead reaches the early gate. Never after |
| `GoogleAdsService.Search` (campaigns) | read | Which campaigns are on a bid strategy that ignores conversion value |

---

## If it goes wrong

| Symptom | Cause |
|---|---|
| `DEVELOPER_TOKEN_NOT_APPROVED` | Test-level token pointed at a real account, or Basic access not granted yet |
| `NOT_FOUND` naming nothing, on a valid account | The customer id carried dashes. The API takes `5932227642`, never `593-222-7642`. `normalizeCustomerId()` strips them |
| Install fails with a redirect error | The redirect URI does not match `${origin}/api/ads/google/callback` exactly. Check the trailing slash and http against https |
| Connection works for an hour, then stops | No refresh token stored. See above |
| Connection breaks after a week | Consent screen still unverified, so the app is in Testing mode |
| "Connecting Google Ads is not set up on this deployment" | One of the settings above is missing. The server log names which |
| Everything refused after a version sunset | Bump `GOOGLE_ADS_API_VERSION`. Google sunsets versions on a published schedule |
