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

Decide the domain first. The redirect URL becomes part of the app, and changing
it later means editing an app customers have already installed. Everything here
assumes:

    https://app.valuebasedbidding.com

Substitute your own everywhere it appears, if it differs.

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

In the `vbb-engine` folder, open this file in TextEdit:

    src/app/app-hsmeta.json

Replace everything in it with this, keeping whatever `uid` the CLI generated if
it differs:

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

- **The redirect URL must match exactly** what our code sends. Ours is built by
  `oauthConfigFromEnv()` in `src/lib/sync/hubspot/oauth.ts` as
  `${origin}/api/crm/hubspot/callback`. No trailing slash. A one-character
  mismatch produces an install error that does not explain itself.
- **The scopes must match `SCOPES`** in that same file. Read-only, three object
  types, nothing else. Worth saying plainly if HubSpot ever reviews the app.
- The CLI's boilerplate ships with `http://localhost:3000/oauth-callback`.
  Replace it rather than adding to it. If you want a local one too, add
  `http://localhost:3000/api/crm/hubspot/callback` as a second entry.

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

## What this does not require

**Marketplace listing.** An app installs through its OAuth link without ever
being listed. Listing is a distribution channel, for being found by strangers
browsing HubSpot's directory. Nothing in our flow depends on it.

---

## If it goes wrong

| Symptom | Cause |
|---|---|
| `hs: command not found` | Node is installed but its global bin is not on PATH. Quit Terminal and reopen it first. |
| `Config file not found, run hs account auth` | Step 3 did not finish. Run `hs init` again. |
| Install fails with a redirect error | The redirect URL in `app-hsmeta.json` does not match `${origin}/api/crm/hubspot/callback` exactly. Check the trailing slash, and http against https. |
| Customer approves, then our page says the connection failed | `HUBSPOT_CLIENT_ID` or `HUBSPOT_CLIENT_SECRET` is missing or wrong in Vercel, or the deploy predates them being set. |
| The sync runs but stores nothing | `VBB_TOKEN_KEY` is unset, so there is nothing to encrypt the token with. The route refuses rather than storing a CRM credential in the clear. |
