# Twilio A2P 10DLC Campaign Notes

## Current readiness: number and routing not verified

- There are currently **no real operator properties or live pilots**; the deployed property records are test/demo data.
- The prior A2P 10DLC campaign was denied (Error 30909). The repository does not prove whether a toll-free number was subsequently purchased or whether Toll-Free Verification was approved; check the Twilio Console before any real pilot.
- `wrangler.toml` sets signature validation on and `PUBLIC_URL` to `https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/sms`. Wrangler reports Twilio secret names are configured, but this does not prove the credentials are valid, a number is owned/registered, or the console webhook matches.
- The exact number's SMS capability/registration status and its inbound webhook URL/method remain **unconfirmed** until an account owner checks Twilio Console. This repository cannot access those account-side settings.

For the first real operator pilot, verify the number and webhook in Twilio Console using the checklist below. The console URL must be an HTTP POST and must exactly match `PUBLIC_URL` while signature validation is enabled.

## Toll-Free Number Instructions

### Why Toll-Free?
- Faster approval (typically 1-2 business days vs. 10DLC which can take weeks)
- Lower cost per message
- No need for complex use-case documentation
- Better for small/medium businesses

### Steps to Set Up Toll-Free Number:

1. **Purchase a Toll-Free Number from Twilio:**
   - Go to Twilio Console → Phone Numbers → Buy
   - Search for a Toll-Free Number
   - Purchase one (typically ~$1.50/month)

2. **Submit Toll-Free Verification (TVC) — required before production traffic:**
   - Twilio Console → Phone Numbers → Toll-Free Verification
   - Unverified toll-free numbers are heavily filtered and volume-capped
   - Use `drafts/optin-evidence.html` (print to PDF) as opt-in evidence if asked
   - Approval typically takes 1-2 business days

3. **Enable SMS on the Toll-Free Number:**
   - In Twilio Console, navigate to the purchased number
   - Under "Messaging", configure the webhook URL to point to your Cloudflare Worker
   - Planned webhook URL after domain setup: `https://api.stayxi.com/sms`
   - This must exactly match `PUBLIC_URL` in `wrangler.toml` (signature validation is ON and computed over this URL)
   - HTTP method: POST (Twilio signs every request with `X-Twilio-Signature`; the worker validates it)

4. **Configure Messaging Service:**
   - Create a new Messaging Service in Twilio
   - Add the Toll-Free Number to the service
   - Set the webhook URL for the messaging service
   - This allows you to manage multiple numbers through one service
   - Inbound SMS through a Messaging Service carry a MessagingServiceSid — the worker looks up by that first, then falls back to the To number

5. **Update Your Code:**
   - The webhook handler in `bot/worker.ts` already works with Toll-Free numbers
   - Signature validation is ON by default (`VALIDATE_SIGNATURE` in wrangler.toml)
   - STOP/HELP/START keywords are handled automatically (KV opt-out)
   - Test with a sample message once the number is verified

6. **Compliance Notes:**
   - Toll-Free numbers have stricter sending rules
   - STOP/HELP/START are handled automatically by the worker (STOP silences the guest, START resumes, HELP replies with info)
   - Opt-in confirmation required before sending
   - Message frequency limits apply

## Previous 10DLC Attempt Details

### What We Submitted:
- Brand: StayXI (make sure the public brand and legal business details match the registration submitted to Twilio)
- Use Case: Property management / guest communications
- Sample messages: Gate codes, WiFi, checkout info, etc.

### Error 30909 Resolution:
- Requires more detailed opt-in flow descriptions
- Need proper sample messages with HELP/STOP keywords
- Need list of opt-in keywords
- Need opt-in confirmation message template

### Sample Messages (for reference if retrying 10DLC):
1. "Richard Harrell: Pool heater is on the lanai wall — press HEAT and set to 86. Takes ~1 hour to warm up. Reply HELP for help or STOP to opt out."
2. "Richard Harrell: Trash pickup is Tuesday AM. Please put bins out Monday night. Reply HELP for help or STOP to opt out."
3. "Sunset Villa: WiFi password is BeachBreeze2024. Gate code changes daily — text for current code. Reply STOP to opt out or HELP for help."

### Opt-in Keywords:
- SUNSET, HARBOR, LAKEVIEW, PALM, OAK, MAGNOLIA (property-specific codes)

### Opt-in Message Template:
Thanks for opting in to [Property Name] support texts! You'll receive gate codes, WiFi, checkout times, and property info. Msg & data rates may apply. Reply STOP to opt out or HELP for help.

## Action Items:
- [ ] Confirm the account has an SMS-capable number assigned for the operator; purchase one only if none exists
- [ ] Confirm the selected number's applicable Toll-Free Verification or A2P registration is approved for intended traffic
- [ ] In Twilio Console, verify the number/service inbound webhook is HTTP POST and exactly matches `PUBLIC_URL`
- [ ] Confirm the Messaging Service includes the selected number and has the expected inbound routing
- [ ] Test SMS flow end-to-end
- [ ] Verify rate limiting works
- [ ] Confirm escalation to host works
