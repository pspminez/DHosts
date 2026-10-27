# StayXI — SMS Bot Deploy Guide

This Worker runs the guest text line. One deploy, one URL, zero servers to maintain.

---

## Prerequisites (do once)

1. **Cloudflare account** → enable **2FA** (this is the real security boundary for gate codes)
2. **Domain** → add `stayxi.com` to Cloudflare and configure DNS before routing production traffic
3. **Twilio account** → upgrade to paid, buy a **Toll-Free number** (recommended) OR a **local 407 area code number** (~$1.15/mo). Toll-Free numbers are preferred: faster approval (1-2 days), lower cost, no complex A2P 10DLC registration.
4. **OpenRouter API key** → `openrouter.ai/keys` → create (the bot calls Claude through OpenRouter)

---

## Step-by-step (copy-paste in order)

```powershell
# 1. Install tooling
npm install -g wrangler

# 2. Login (opens browser)
wrangler login

# 3. Create KV namespace
wrangler kv namespace create PROPERTIES
# → copy the returned ID into wrangler.toml (kv_namespaces[0].id)

# 4. Create the configured D1 database
wrangler d1 create davenport-host-co-db
# → copy the returned UUID into wrangler.toml (d1_databases[0].database_id)

# 5. Initialize a new D1 database
npx wrangler d1 execute davenport-host-co-db --remote --file=./schema.sql

# 6. Set secrets (one command each, paste the value when prompted)
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put OPENROUTER_API_KEY   # openrouter.ai/keys — calls Claude for unscripted questions
wrangler secret put ADMIN_PASSWORD       # pick a strong one

# 7. Install deps & deploy
cd C:\Users\lovem\Documents\davenport-host-co
npm install
wrangler deploy
```

For an **existing database that already has the original schema**, do not run
`schema.sql` again. Apply the ordered migrations instead:

```powershell
npx wrangler d1 migrations apply davenport-host-co-db --remote
```

The operations migration backfills the 180-day expiry for existing messages
and escalations. A daily Worker cron removes expired messages, escalations,
thread records, and AI interaction audit records; pending critical changes
expire after 30 days. A five-minute cron recovers interrupted host replies.
Apply migrations before deploying Worker code that reads or writes the new
tables.

### Production release checklist

For the pilot dashboard release, use the existing configured production account,
Worker, KV namespace, and D1 database; do not create replacement resources.
Before applying changes, confirm the active Cloudflare account and review
`npx wrangler d1 migrations list davenport-host-co-db --remote`. The pilot
release should show only `0007_pilot_properties.sql` pending. Review that
migration and take/verify a D1 backup before proceeding. Then, from the project
root, apply the additive migration before publishing the Worker:

```powershell
npx wrangler d1 migrations apply davenport-host-co-db --remote
npx wrangler deploy --strict --message "Add pilot setup, launch gates, and persistent scorecards"
```

After deploy, run the authenticated, read-only production check from the repo root
(`STAYXI_ADMIN_PASSWORD` must be set in your shell; the script does not print it):

```powershell
$securePassword = Read-Host "Admin password" -AsSecureString
$env:STAYXI_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
try { npm run check:production } finally { Remove-Item Env:STAYXI_ADMIN_PASSWORD }
```

It checks public `/health`, Pilot markup, authenticated admin health, and verifies
pilot records remain inaccessible without authentication; it does not create,
edit, or activate any property. Then sign in to `/admin` and confirm the Pilot
tab and metadata-only activity summary load. Exercise setup and launch gates only
with an explicitly inactive **test property**; tests and demo fixtures are not
real pilot evidence. Delete test records when finished. Never activate a test
record on a guest-facing number or send test SMS to guests. Review Worker logs
and D1 migration status before considering the release complete. If any step
fails, stop and investigate rather than retrying a potentially partial
production action.

## Google Workspace pilot outreach

The Admin Leads panel can send **one individually reviewed first-contact email**
from one connected Google Workspace mailbox. It does not read the mailbox,
send bulk email, schedule follow-ups, or automate texts. Google authorization
requests only the sensitive `gmail.send` scope. Google may require OAuth app
verification for accounts outside your Workspace organization; for a
single-organization Workspace app, configure the OAuth audience as Internal
where available. See Google's [Gmail scope guidance](https://developers.google.com/workspace/gmail/api/auth/scopes),
[send-message guide](https://developers.google.com/workspace/gmail/api/guides/sending),
and [server-side OAuth guide](https://developers.google.com/workspace/gmail/api/auth/web-server).

1. In Google Cloud Console, select a project, enable the **Gmail API**, and
   configure the OAuth consent screen. Create an OAuth client of type **Web
   application**. Add this exact authorized redirect URI:

   `https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/admin/google/oauth/callback`

   If the Worker hostname changes, update both the OAuth client and
   `GMAIL_OAUTH_REDIRECT_URI` in `wrangler.toml` to match exactly.
2. Set the OAuth client and mail configuration as Worker secrets:

   ```powershell
   npx wrangler secret put GMAIL_CLIENT_ID
   npx wrangler secret put GMAIL_CLIENT_SECRET
   npx wrangler secret put GMAIL_FROM_EMAIL
   npx wrangler secret put GMAIL_MAILING_ADDRESS
   ```

   `GMAIL_FROM_EMAIL` must be the connected mailbox or one of its Gmail
   send-as aliases. `GMAIL_MAILING_ADDRESS` must be StayXI's accurate postal
   mailing address; it is appended to each outreach message.
3. Generate an independent 32-byte encryption key locally and add it as a
   Worker secret. In PowerShell:

   ```powershell
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $bytes = New-Object byte[] 32
   $rng.GetBytes($bytes)
   [Convert]::ToBase64String($bytes)
   $rng.Dispose()
   npx wrangler secret put GMAIL_TOKEN_ENCRYPTION_KEY
   ```

   Paste the generated Base64 value when prompted. Do not commit it or put it
   in `wrangler.toml`. The OAuth refresh token is encrypted with AES-GCM before
   it is stored in the existing `PROPERTIES` KV namespace.
4. Apply the D1 migrations, including `0006_gmail_outreach.sql`, before
   deploying code that uses Gmail outreach:

   ```powershell
   npx wrangler d1 migrations apply davenport-host-co-db --remote
   ```

5. In Admin > Leads, choose **Connect Google account** and approve the
   send-only permission. A pitch can only be sent to a lead with a recently
   verified public email. Recheck the source, personalize the draft, replace
   every bracketed placeholder, confirm the recipient, then explicitly confirm
   the send. A one-click unsubscribe and the configured mailing address are
   appended automatically. Suppression records use an email hash; delivery
   metadata (not message contents) is retained for up to 180 days.

The send log reserves a lead/recipient pair before sending. If Google's reply
is ambiguous, the send is marked `unknown` and is not automatically retried;
check Gmail Sent before taking any further action. Disconnect removes the
encrypted token from Cloudflare; also revoke StayXI's OAuth grant in your
Google Account if you want to revoke Google's authorization.

---

## Lead list and outreach rules

`bot/leads.js` is the source for the Admin Leads tab. The working list is
intentionally short and focused on real Central Florida operators. Each lead
links the official pages used for its public details, and each tailored pitch
includes `pitchSource` and `pitchCheckedAt` for the opening fact. Recheck them
before contact. Add an email only when an appropriate business address is
published by the company itself; record `emailSource` and `emailCheckedAt`, and
never use a guest/reservation inbox as a management contact. If no suitable
email is published, leave it blank and use the official form or phone.

Pitch drafts are discovery-first, prospect-specific, and do not assert a need or
promise StayXI capabilities beyond the current pilot. Replace all placeholders,
check contact preferences, and personalize before any one-to-one send. `npm test`
runs `bot/leads.test.js` to guard against fabricated contact data, unsafe
knowledge samples, and missing sources. See [`knowledge/pitch-workflow.md`](knowledge/pitch-workflow.md) for
research, outreach, and template-safety rules. The CSV export includes `fit`,
`emailVerified`, `emailSource`, `emailCheckedAt`, and `contactName`.

See [`../LAUNCH_READINESS.md`](../LAUNCH_READINESS.md) for what is still required
before a pilot property goes live.

---

## Add your first property

After deploy, the Worker is live but knows no houses. A property needs **both** a D1 row and a KV entry (`prop:<id>`); the admin UI edits both once the D1 row exists.

**Step 1 — insert the D1 rows (one time, from the repo root):**
```powershell
# The host row must exist first: properties.host_id references hosts(id).
npx wrangler d1 execute davenport-host-co-db --remote --command "INSERT INTO hosts (id, name, phone) VALUES ('host1', 'Your Name', '+18635551234')"
npx wrangler d1 execute davenport-host-co-db --remote --command "INSERT INTO properties (id, house_code, display_name, host_id, twilio_number, active) VALUES ('SUNSET', 'SUNSET', 'Sunset Villa', 'host1', '+18005551234', 1)"
```

**Step 2 — fill in the answers, either way:**

*Option A (admin UI — easiest):*
1. Open `https://stayxi.com/admin` once the Pages custom domain is configured (the current temporary URL is `https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/admin`)
2. Enter your `ADMIN_PASSWORD`
3. Select the property → import reviewed `secrets` and `answers` JSON through **Knowledge import** (start with `bot/knowledge/template.json`; copy approved examples into `answers`). Sensitive access and critical answers are staged for review before publishing.

*Option B (CLI — non-critical data only; bypasses critical-item review):*
```powershell
# Copy template.json privately, replace ALL bracketed placeholders with operator-confirmed values,
# review every answer, and never import the template unchanged into a live property.
# The KV key is prop:<property id> — the same id as the D1 row, NOT the phone number:
# For live data, prefer Admin > Properties > Knowledge import so critical items are staged for review.
# A direct KV write bypasses that review; do not use it for access codes or critical answers.
npx wrangler kv key put --binding=PROPERTIES "prop:SUNSET" --path=./private/SUNSET-knowledge.json
```

`npm test` runs these commands against a throwaway local database as well as the unit tests, so text that stops working fails there instead of during your first pilot. It starts Wrangler, so it takes about half a minute — `npm run test:unit` is the fast loop.

Then verify an approved, non-sensitive answer on the Twilio number. Test gate or door codes only in a controlled non-guest environment after the critical information has been reviewed and published.

---

## Verify it works

```powershell
# Watch live logs
wrangler tail

# In another terminal, text your Twilio number from your phone:
# "SUNSET what's the wifi"
# You should see the request hit, the KB match, and the reply go out.
```

When an escalation is sent to a host, the alert includes an escalation ID.
The host can text `#<id> <reply>` to the configured Twilio line; StayXI relays
that reply to the guest and records the response time. Host replies are sent
only for an open escalation assigned to that host number. The admin Operations
tab also provides aggregate 24-hour activity, open escalations, AI failures,
30-day host response time, and a test console that never sends SMS or calls AI.
`GET /health` checks the D1 and KV dependencies without exposing configuration.
OpenRouter and Twilio requests retry once after an explicit HTTP 429 response;
ambiguous network failures are not retried automatically to avoid duplicate
SMS or paid AI requests.

---

## Twilio webhook and number readiness

The currently deployed Worker is configured to validate signatures for:

```
POST https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/sms
```

The account's secret names and the configured `PUBLIC_URL` are not proof that a
number is registered, assigned, or correctly routed. Before the first real
operator pilot, inspect the Twilio Console directly: verify the exact number's
ownership and SMS capability, its Toll-Free Verification or applicable A2P
status, and the inbound Messaging Service/number webhook URL and method. The
actual webhook must exactly match `PUBLIC_URL` in `wrangler.toml` (scheme, host,
path) while signature validation is enabled. Do not change it to
`api.stayxi.com` until that custom endpoint is configured and Twilio is switched
at the same time. A read-only smoke check cannot verify Twilio's console-side
registration or end-to-end message delivery.

---

## Adding more properties

Each property gets its own **house code** (word, e.g. `FLAMINGO`, `MICKEY`).

1. Create the property and host rows in D1 (see "Add your first property").
2. In Admin, open the property and import its reviewed knowledge JSON through **Knowledge import**; do not put private property data in the repository or write critical answers directly to KV, which bypasses staged review.
3. If using a shared number, keep the same `twilioNumber`; the property ID distinguishes the homes.

---

## Updating answers (no redeploy)

Edit in the admin UI at `/admin` — changes are live instantly.

Or edit the JSON in Cloudflare Dashboard → Workers KV → `PROPERTIES` → find `prop:SUNSET` (the property's id) → Edit.

---

## What the secrets mean

| Secret | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Identifies your Twilio account |
| `TWILIO_AUTH_TOKEN` | Signs webhook requests + sends outbound SMS |
| `OPENROUTER_API_KEY` | Calls Claude (via OpenRouter) for unscripted questions |
| `ADMIN_PASSWORD` | Protects the `/admin` editor and all `/admin/api/*` routes |

---

## If something breaks

| Symptom | Check |
|---|---|
| Texts not arriving | `wrangler tail` — is the POST hitting? Twilio Console → Debugger → any errors? |
| "Invalid signature" | Check `PUBLIC_URL` in `wrangler.toml` matches the Twilio webhook URL exactly (scheme, host, path). For local dev only: `VALIDATE_SIGNATURE="false"` |
| Gate code not sent | Admin UI → Secrets tab — is the keyword an **exact word-boundary match**? |
| AI replies wrong thing | Admin UI → Answers — add a canned entry for that keyword so it never reaches AI |
| Host never gets escalation SMS | `hostPhone` set for the property (hosts table)? `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` secrets set? Toll-free number verified? |
| Bill spikes | `wrangler tail` → check `RL` keys → look for one `From` number hammering the bot |

---

## Local dev (optional)

```powershell
# .dev.vars file (gitignored) with:
# TWILIO_ACCOUNT_SID=...
# TWILIO_AUTH_TOKEN=...
# OPENROUTER_API_KEY=...
# ADMIN_PASSWORD=...
# VALIDATE_SIGNATURE=false   # local dev only — real signatures come from Twilio

wrangler dev --port 8787
# Test with: curl -X POST http://localhost:8787/sms -d "From=+15551234567&To=+14075550100&Body=SUNSET%20wifi"
```