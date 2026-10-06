# Davenport Host Co. — SMS Bot Deploy Guide

This Worker runs the guest text line. One deploy, one URL, zero servers to maintain.

---

## Prerequisites (do once)

1. **Cloudflare account** → enable **2FA** (this is the real security boundary for gate codes)
2. **Domain** → buy `davenporthost.co` (or similar) at Cloudflare Registrar (~$10/yr)
3. **Twilio account** → upgrade to paid, buy a **407 area code** number (~$1.15/mo)
4. **Anthropic API key** → `console.anthropic.com` → API Keys → create

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
wrangler secret put TWILIO_MESSAGING_SERVICE_SID
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put VAULT_KEY        # generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
wrangler secret put ADMIN_PASSWORD   # pick a strong one

# 7. Install deps & deploy
cd C:\Users\lovem\Documents\davenport-host-co
npm install
wrangler deploy
```

---

## Add your first property

After deploy, the Worker is live but knows no houses.

**Option A (admin UI — easiest):**
1. Open `https://responder.davenporthost.co/admin`
2. Enter your `ADMIN_PASSWORD`
3. Click "Import template" → paste the JSON from `bot/knowledge/template.json` → edit the values → Save

**Option B (CLI — one-liner):**
```powershell
# Replace the values, then run:
wrangler kv:key put --binding=PROPERTIES "prop:+14075550100" --path=./bot/knowledge/template.json
```

Then text your Twilio number: `SUNSET what's the gate code` — you should get the code back.

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
POST https://responder.davenporthost.co/sms
```

(If you use a custom domain, put that instead.)

---

## Adding more properties

Each property gets its own **house code** (word, e.g. `FLAMINGO`, `MICKEY`).

1. Copy `bot/knowledge/template.json` → `bot/knowledge/FLAMINGO.json`
2. Edit: `id`, `name`, `twilioNumber` (can share the same number), `hostPhone`, all the answers
3. Import via admin UI or CLI:
   ```powershell
   wrangler kv:key put --binding=PROPERTIES "prop:+14075550100" --path=./bot/knowledge/FLAMINGO.json
   ```
   (If using a shared number, the `twilioNumber` is the same; the `id` (`FLAMINGO`) is what distinguishes them.)

---

## Updating answers (no redeploy)

Edit in the admin UI at `/admin` — changes are live instantly.

Or edit the JSON in Cloudflare Dashboard → Workers KV → `PROPERTIES` → find `prop:+1407...` → Edit.

---

## What the secrets mean

| Secret | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Identifies your Twilio account |
| `TWILIO_AUTH_TOKEN` | Signs webhook requests + sends outbound SMS |
| `TWILIO_MESSAGING_SERVICE_SID` | The Messaging Service SID (from Twilio Console → Messaging → Services) |
| `ANTHROPIC_API_KEY` | Calls Claude for unscripted questions |
| `VAULT_KEY` | 32-byte base64 key — encrypts gate/door codes at rest in KV |
| `ADMIN_PASSWORD` | Protects the `/admin` editor |

---

## If something breaks

| Symptom | Check |
|---|---|
| Texts not arriving | `wrangler tail` — is the POST hitting? Twilio Console → Debugger → any errors? |
| "Invalid signature" | `VALIDATE_SIGNATURE=false` in `wrangler.toml` temporarily; then check `PUBLIC_URL` matches the webhook URL exactly |
| Gate code not sent | Admin UI → Secrets tab — is the keyword an **exact word-boundary match**? |
| AI replies wrong thing | Admin UI → Answers — add a canned entry for that keyword so it never reaches AI |
| Host never gets escalation SMS | `hostPhone` set on the property? `TWILIO_MESSAGING_SERVICE_SID` correct? |
| Bill spikes | `wrangler tail` → check `RL` keys → look for one `From` number hammering the bot |

---

## Local dev (optional)

```powershell
# .dev.vars file (gitignored) with:
# TWILIO_ACCOUNT_SID=...
# TWILIO_AUTH_TOKEN=...
# TWILIO_MESSAGING_SERVICE_SID=...
# ANTHROPIC_API_KEY=...
# VAULT_KEY=...
# ADMIN_PASSWORD=...

wrangler dev --port 8787
# Test with: curl -X POST http://localhost:8787/sms -d "From=+15551234567&To=+14075550100&Body=SUNSET%20wifi"
```