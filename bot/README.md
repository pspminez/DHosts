# Davenport Host Co. — SMS Bot Deploy Guide

This Worker runs the guest text line. One deploy, one URL, zero servers to maintain.

---

## Prerequisites (do once)

1. **Cloudflare account** → enable **2FA** (this is the real security boundary for gate codes)
2. **Domain** → buy `davenporthost.co` (or similar) at Cloudflare Registrar (~$10/yr)
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

# 4. Create D1 database
wrangler d1 create davenport
# → copy the returned UUID into wrangler.toml (d1_databases[0].database_id)

# 5. Run schema
wrangler d1 execute davenport --remote --file=./schema.sql

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
1. Open `https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/admin`
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

---

## Twilio webhook config

In Twilio Console → Messaging → Services → your service → **Inbound Webhook**:

```
POST https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/sms
```

This must exactly match `PUBLIC_URL` in `wrangler.toml` — the signature is computed over it. (A custom domain works too; update both together.)

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