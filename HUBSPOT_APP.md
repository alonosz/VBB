# Creating the HubSpot app

The public app is what lets a customer connect their HubSpot by clicking a
link, instead of creating a private app in their own portal and emailing us a
token.

**There is no longer a button for this.** HubSpot sunset legacy public app
creation on 23 June 2026. The "Create Legacy App" dialog now offers only
Private, and the tooltip over Public says new legacy public app creation is
disabled. Public apps are created from the command line.

This is more technical than it should be and there is no way around it. What
follows is the whole job, in order, with nothing left implied.

---

## Before you start

Decide the domain first. The redirect URL is part of the app config, and
changing it later means editing and re-uploading a live app that customers have
already installed. Everything below assumes:

    https://app.valuebasedbidding.com

Substitute your own if it differs, in every place it appears.

You also need a **HubSpot developer account**, which is a different thing from
a normal HubSpot login. `developers.hubspot.com`, free.

---

## 1. Install Node and the HubSpot CLI

Node from `nodejs.org`, the LTS version. Then, in Terminal:

```bash
npm install -g @hubspot/cli
```

Check it worked:

```bash
hs --version
```

## 2. Log the CLI into your developer account

```bash
hs init
```

This opens a browser, asks which account to connect, and gives you a personal
access key to paste back. Pick the **developer** account, not a portal.

## 3. Create the project

```bash
hs project create
```

It asks a series of questions. The answers that matter:

| Question | Answer |
|---|---|
| Project name | `vbb-engine` |
| Project template / base | **App** |
| Distribution | **Marketplace**, not private |
| Authentication | **OAuth** |

"Marketplace" here does **not** mean you have to list the app publicly. It
means OAuth installs are not restricted to a pre-approved list of portals,
which is what you want for design partners. Nobody finds the app unless you
send them the link.

## 4. Replace the app config

The project it generated contains a file at:

    src/app/app-hsmeta.json

Open it and replace its contents with this, keeping whatever `uid` the CLI
generated if it differs:

```json
{
  "uid": "vbb_engine",
  "type": "app",
  "config": {
    "name": "Value Based Bidding",
    "description": "Works out what each lead is worth from your own closed deals, and sends those values to Google Ads. Read-only: nothing in your CRM is changed.",
    "distribution": "marketplace",
    "auth": {
      "type": "oauth",
      "redirectUrls": [
        "https://app.valuebasedbidding.com/api/crm/hubspot/callback"
      ],
      "requiredScopes": [
        "crm.objects.deals.read",
        "crm.objects.contacts.read",
        "crm.objects.companies.read"
      ]
    }
  }
}
```

Three things about this file:

- **The redirect URL must match exactly** what the code sends. Our value comes
  from `oauthConfigFromEnv()` in `src/lib/sync/hubspot/oauth.ts`, built as
  `${origin}/api/crm/hubspot/callback`. No trailing slash. A mismatch of one
  character produces an install error that does not explain itself.
- **The scopes must match `SCOPES`** in that same file. They are read-only, on
  three object types, and the app needs nothing else. That is worth stating
  plainly if HubSpot ever reviews it.
- The CLI's boilerplate ships with `http://localhost:3000/oauth-callback` as
  the redirect. Replace it rather than adding to it, unless you want a local
  one too, in which case add
  `http://localhost:3000/api/crm/hubspot/callback` as a second entry.

## 5. Upload it

```bash
hs project upload
```

## 6. Copy the credentials into Vercel

The Client ID and Client Secret appear in your developer account under the app,
on its auth settings. Put them in Vercel as:

    HUBSPOT_CLIENT_ID
    HUBSPOT_CLIENT_SECRET

Redeploy. The connect button on step 5 is now live.

---

## What a customer sees after this

They click **Connect HubSpot**, HubSpot asks them to approve read access to
deals, contacts and companies, and they land back on our page connected. No
app to create, no token to copy, no email carrying a credential.

They may need Super Admin in their own HubSpot to approve it, or the "App
Marketplace Access" permission that Super Admins carry automatically. Worst
case that is one forwarded link.

## What this does not require

**Marketplace listing.** An app can be installed through its OAuth link without
ever being listed. Listing is a distribution channel for being found by
strangers browsing HubSpot's directory, and nothing in our flow depends on it.

---

## If it goes wrong

| Symptom | Cause |
|---|---|
| `hs: command not found` | Node installed but the global npm bin is not on PATH. Restart Terminal first. |
| Install fails with a redirect error | The redirect URL in `app-hsmeta.json` does not match `${origin}/api/crm/hubspot/callback` exactly. Check for a trailing slash and for http vs https. |
| Customer approves, then our page says the connection failed | `HUBSPOT_CLIENT_ID` or `HUBSPOT_CLIENT_SECRET` missing or wrong in Vercel, or the deploy predates them being set. |
| The sync runs but stores nothing | `VBB_TOKEN_KEY` is unset, so there is nothing to encrypt the token with. The route says so rather than storing it in the clear. |
