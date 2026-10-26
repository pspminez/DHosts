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

`bot/leads.js` is the single source of truth for the admin Leads tab. Only real
businesses with a public website and business phone belong in it, and an `email`
is set **only** when the address is published on the company's own site — always
with `emailSource` and `emailCheckedAt`. `npm test` runs `bot/leads.test.js`,
which fails if fabricated data (fictional `555` numbers, example or guessed
emails) or an unsourced email is introduced.

Each lead carries a `fit` tier (A = independent Central-Florida operator,
B = regional, C = large national). The admin Leads tab has a **"With verified
email"** filter and a live count so you can work only leads you can contact. The
CSV export includes `fit`, `emailVerified`, `emailSource`, `emailCheckedAt`, and
`contactName`.

See [`../LAUNCH_READINESS.md`](../LAUNCH_READINESS.md) for what is still required
before a pilot property goes live.

---

## Add your first property

After deploy, the Worker is live but knows no houses. A property needs **both** a D1 row and a KV entry (`prop:<id>`); the admin UI edits both once the D1 row exists.

**Step 1 — insert the D1 rows (one time, from the repo root):**
```powershell
npx wrangler d1 execute davenport-host-co-db --remote --command "INSERT INTO properties (id, display_name, host_id, twilio_number, active) VALUES ('SUNSET', 'Sunset Villa', 'host1', '+18005551234', 1)"
npx wrangler d1 execute davenport-host-co-db --remote --command "INSERT INTO hosts (id, phone) VALUES ('host1', '+18635551234')"
```

**Step 2 — fill in the answers, either way:**

*Option A (admin UI — easiest):*
1. Open `https://stayxi.com/admin` once the Pages custom domain is configured (the current temporary URL is `https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/admin`)
2. Enter your `ADMIN_PASSWORD`
3. Select the property → edit answers and secrets (start from `bot/knowledge/template.json`) → Save & go live

*Option B (CLI):*
```powershell
# The KV key is prop:<property id> — the same id as the D1 row, NOT the phone number:
wrangler kv:key put --binding=PROPERTIES "prop:SUNSET" --path=./bot/knowledge/template.json
```

Then text your Twilio number: `what's the gate code` — you should get the code back.

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

## Twilio webhook config

In Twilio Console → Messaging → Services → your service → **Inbound Webhook**:

```
POST https://api.stayxi.com/sms (after the custom Worker domain is configured)
```

This must exactly match `PUBLIC_URL` in `wrangler.toml` — the signature is computed over it. Until `api.stayxi.com` is configured and Twilio is switched, keep the currently active workers.dev webhook URL in Twilio and `PUBLIC_URL`.

---

## Adding more properties

Each property gets its own **house code** (word, e.g. `FLAMINGO`, `MICKEY`).

1. Copy `bot/knowledge/template.json` → `bot/knowledge/FLAMINGO.json`
2. Edit: `id`, `name`, `twilioNumber` (can share the same number), `hostPhone`, all the answers
3. Insert a D1 row for the new property (see "Add your first property"), then write the KV half:
   ```powershell
   wrangler kv:key put --binding=PROPERTIES "prop:FLAMINGO" --path=./bot/knowledge/FLAMINGO.json
   ```
   (If using a shared number, the `twilioNumber` is the same; the `id` (`FLAMINGO`) is what distinguishes them.)

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