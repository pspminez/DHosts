# Twilio A2P 10DLC Campaign Notes

## Status: DENIED (Error 30909)
The A2P 10DLC campaign was rejected. We will switch to a Toll-Free Number approach.

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
   - Set webhook URL: `https://davenport-host-co-bot.davenport-host-co-bot.workers.dev/sms`
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
- Brand: Davenport Host Co.
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
- [ ] Purchase Toll-Free Number from Twilio
- [ ] Submit Toll-Free Verification (TVC)
- [ ] Configure webhook URL
- [ ] Update messaging service settings
- [ ] Test SMS flow end-to-end
- [ ] Verify rate limiting works
- [ ] Confirm escalation to host works
"Thanks for opting in to [Property Name] support texts! You'll receive gate codes, WiFi, checkout times, and property info. Msg & data rates may apply. Reply STOP to opt out or HELP for help."