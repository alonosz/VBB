# Creating the HubSpot app

The public app is what lets a customer connect their HubSpot by clicking a
link, instead of creating a private app in their own portal and emailing us a
token.

**There is no button for this.** HubSpot sunset legacy public app creation on
23 June 2026. In a developer account, Development → Legacy Apps offers Private
only, and Development → Projects → Create project just prints two CLI commands
at you. Public apps are created from the command line, and that is the only
way.

Verified against HubSpot CLI **8.14.0** on 30 August 2026. Every question the
wizard would ask has a command-line flag, so the version below has nothing to
answer.

---

## Before you start

`redirectUrls` is a **list**, so this is not the one-way door it looks like.
Put every address the app will ever answer on in from the start and the day a
custom domain goes live is a non-event.

Two are configured today:

    https://vbb-cyan.vercel.app          the Vercel URL, live now
    https://app.valuebasedbidding.com    the custom domain, not yet pointed

Our code builds the callback from whatever domain it is actually running on
(`feedOrigin()`, falling back to `VERCEL_PROJECT_PRODUCTION_URL`). So it sends
the Vercel one today, and starts sending the custom one the moment
`VBB_PUBLIC_ORIGIN` is set to it. Both being listed is what makes that switch
cost nothing.

You also need a **HubSpot developer account**, which is a different thing from
a normal HubSpot login. Free, at `developers.hubspot.com`.

---

## Step 1 - open Terminal

On a Mac: `Cmd + Space`, type `terminal`, press Enter. A text window opens.
Every command below is typed there, one at a time, each followed by Enter.

## Step 2 - check you have Node

```bash
node -v
```

- A version number (`v22.11.0` or similar) means carry on.
- `command not found` means go to `nodejs.org`, download the big LTS button,
  install it, then **quit Terminal and open it again** before retrying.

## Step 3 - install the CLI and log in

```bash
npm install -g @hubspot/cli && hs init
```

If that fails with `EACCES` or `permission denied`, run the same thing with
`sudo` in front. It asks for your Mac password, and nothing appears on screen
as you type it. That is normal, keep typing and press Enter.

`hs init` opens a browser, asks which account to connect, and gives you a long
key to paste back into Terminal. Choose the **developer** account, not a
customer portal.

## Step 4 - create the project

```bash
cd ~/Desktop
hs project create --name vbb-engine --dest ./vbb-engine \
  --project-base app --distribution marketplace --auth oauth
```

No questions. It leaves a `vbb-engine` folder on your Desktop.

`--distribution marketplace` sounds wrong and is right. It means OAuth installs
are not restricted to a pre-approved list of portals. It does **not** list the
app publicly, and nobody finds it unless you send them the link. The
alternative, `private`, would mean adding each customer's portal ID by hand.

## Step 5 - set the config

The CLI generates a placeholder config. Its real shape, as of CLI 8.14.0, is
richer than the docs suggest and it asks for **write access to contacts**,
which we must not ship: we never write anything, and asking for write is the
fastest way to lose someone at the approval screen.

Do not open it in TextEdit. TextEdit turns straight quotes into curly ones,
which is invalid JSON and produces an error that never mentions quotes. Write
it from Terminal instead. The wildcard finds the app folder whatever the CLI
named it (the name in its tree diagram is the component, not the directory):

```bash
cat > ~/Desktop/vbb-engine/*/app/app-hsmeta.json <<'EOF'
{
  "uid": "vbb_engine_app",
  "type": "app",
  "config": {
    "description": "Works out what each lead is worth from your own closed deals, and sends those values to Google Ads. Read-only: nothing in your CRM is changed.",
    "name": "Value Based Bidding",
    "distribution": "marketplace",
    "auth": {
      "type": "oauth",
      "redirectUrls": [
        "https://vbb-cyan.vercel.app/api/crm/hubspot/callback",
        "https://app.valuebasedbidding.com/api/crm/hubspot/callback"
      ],
      "requiredScopes": [
        "oauth",
        "crm.objects.deals.read",
        "crm.objects.contacts.read",
        "crm.objects.companies.read"
      ],
      "optionalScopes": [],
      "conditionallyRequiredScopes": []
    },
    "permittedUrls": {
      "fetch": [
        "https://api.hubapi.com"
      ],
      "iframe": [],
      "img": []
    },
    "support": {
      "supportEmail": "alon@bettersignals.co",
      "documentationUrl": "https://vbb-cyan.vercel.app",
      "supportUrl": "https://vbb-cyan.vercel.app"
    }
  }
}
EOF
```

Check it took:

```bash
cat ~/Desktop/vbb-engine/*/app/app-hsmeta.json
```

What changed from the generated template, and why:

- **Dropped `crm.objects.contacts.write`.** We never write to a CRM. See above.
- **Added `crm.objects.deals.read` and `crm.objects.companies.read`**, which
  are what the analysis actually reads.
- **Kept `oauth`.** HubSpot requires it on every OAuth app, and `SCOPES` in
  `src/lib/sync/hubspot/oauth.ts` had to gain it to match. HubSpot refuses an
  install whose authorize URL omits a scope the app declares as required, and
  refuses one that requests a scope the app does not declare. The two lists
  have to be identical in both directions, and the error says "mismatch"
  without naming the scope.
- **Both redirect URLs**, replacing the boilerplate `http://localhost:3000`.
  They must match what our code sends: `oauthConfigFromEnv()` in
  `src/lib/sync/hubspot/oauth.ts` builds `${origin}/api/crm/hubspot/callback`,
  no trailing slash. A one-character mismatch produces an install error that
  does not explain itself. Add
  `http://localhost:3000/api/crm/hubspot/callback` too if you want to test
  against a local server.
- **Dropped the placeholder `supportPhone`** (`+18005555555`). A fake support
  number shown to someone installing the app is worse than no number.
- **Real name, description and support links.** These are what a customer
  reads on the approval screen.

## Step 6 - upload

```bash
cd ~/Desktop/vbb-engine
hs project upload
```

The project now appears under Development → Projects in your developer account.

## Step 7 - copy the credentials into Vercel

The Client ID and Client Secret are on the app's auth settings in your
developer account. In Vercel, add:

    HUBSPOT_CLIENT_ID
    HUBSPOT_CLIENT_SECRET

Redeploy. The Connect HubSpot button on step 5 is now live.

---

## What a customer sees after this

They click **Connect HubSpot**, HubSpot asks them to approve read access to
deals, contacts and companies, and they land back on our page connected. No app
to create, no token to copy, no email carrying a credential.

They may need Super Admin in their own HubSpot to approve it, or the "App
Marketplace Access" permission that Super Admins carry automatically. Worst
case that is one forwarded link.

## Sign the Acceptable Use Policy before testing

Found the hard way, 30 Aug. The first install attempt failed with:

> The app could not be installed because the app developer has not signed the
> acceptable use policy. Please contact the app developer.

Everything on our side had worked. HubSpot accepted the redirect URL, the
scopes and the signed state, then refused at the last step because the
**developer account** had never accepted HubSpot's developer terms. This
applies to every OAuth app, listed or not.

In the developer account's left sidebar, look under **Technology Partner**
first (the Technology Partner Program Agreement lives there), then
**Marketplace Listings**. It is well hidden. If neither offers it, HubSpot
developer support can enable it.

This is a signature, not a review. It costs a click, not weeks. But nothing
installs until it is done, so do it before booking a call with a design
partner.

## Approval, and the 25-install ceiling

**Nothing has to be approved before a customer can connect.** The app exists,
it is deployed, and its OAuth link works today. Listing on the App Marketplace
is a separate, optional thing.

**But an unlisted app is capped at 25 installs.** A marketplace-distribution
app that has not been reviewed and listed stops accepting new installs at 25
accounts, and HubSpot does not grant exceptions or temporary increases, in any
circumstance including an active migration or a burst of onboarding.

For comparison, the alternatives are worse: a private-distribution OAuth app
caps at 10 allowlisted accounts, and a static-token app installs into 1
standard account. Marketplace distribution is the right choice, it just has a
ceiling.

What that means in practice:

| Customers | What is needed |
|---|---|
| 1 to 25 | Nothing. Send the link. |
| 25 onward | The Marketplace listing must be approved first. |

The listing also cannot be done first: it requires a small number of live
installs before HubSpot will review it, reported as three. So the order is
forced, and it is the right order anyway - onboard pilots, then apply.

**Start the listing well before customer 20.** Review takes weeks and is
outside our control, and hitting 25 with no listing in flight means telling a
customer to wait.

---

## If it goes wrong

| Symptom | Cause |
|---|---|
| `hs: command not found` | Node is installed but its global bin is not on PATH. Quit Terminal and reopen it first. |
| `Config file not found, run hs account auth` | Step 3 did not finish. Run `hs init` again. |
| Install fails with a redirect error | The redirect URL in `app-hsmeta.json` does not match `${origin}/api/crm/hubspot/callback` exactly. Check the trailing slash, and http against https. |
| Install fails with a scope mismatch | `requiredScopes` in `app-hsmeta.json` and `SCOPES` in `src/lib/sync/hubspot/oauth.ts` have drifted apart. They must match exactly, in both directions. |
| Customer approves, then our page says the connection failed | `HUBSPOT_CLIENT_ID` or `HUBSPOT_CLIENT_SECRET` is missing or wrong in Vercel, or the deploy predates them being set. |
| The sync runs but stores nothing | `VBB_TOKEN_KEY` is unset, so there is nothing to encrypt the token with. The route refuses rather than storing a CRM credential in the clear. |
| "Reading a CRM is not set up on this deployment yet" | Almost always `VBB_TOKEN_KEY` being **shorter than 24 characters**. It is refused rather than padded, because a key derived from a short passphrase encrypts just as convincingly and protects nothing - and from outside that looks identical to having no database. Generate one with `openssl rand -base64 32`. The server log names the missing setting. |
