# StayXI — Launch Readiness

_Status snapshot: 2026-10-26. This is an operating checklist, not legal or financial advice._

This file answers one question: **what is actually left before StayXI can take a paying pilot property?** Everything below is either *built*, *blocked on a purchase/credential only you can provide*, or *still to do*. Be honest with yourself about which column each item is in before spending money.

---

## 1. What is built and working today

| Piece | Where | State |
|---|---|---|
| Guest SMS bot (webhook, routing, escalation, STOP/HELP) | `bot/worker.ts` | Working, `npm test` = 26/26 pass |
| Property answer library + secrets (gate codes) | D1 + `PROPERTIES` KV | Working |
| Admin panel (Properties / Leads / Analytics / Operations / Pilot) | inlined in `bot/worker.ts` | Working |
| One-to-one Gmail outreach (send-only, unsubscribe, suppression) | admin Leads tab | Built, **not connected** (needs Google OAuth) |
| Marketing site | `site/index.html`, `privacy.html`, `terms.html` | Ready to deploy to Pages |
| Pilot program + terms | `PILOT_PROGRAM.md` | Written |
| Lead list | `bot/leads.js` | Cleaned; **12 of 49 have a verified public email** |

Run `npm test` to confirm the bot logic and lead-data rules before any deploy.

---

## 2. Blockers before a single guest can text you

These are the hard gates. Each needs a purchase or a credential only you can create.

1. **Buy the domain (`stayxi.com`) and add it to Cloudflare.** Needed for the site's custom domain, `api.stayxi.com` for the SMS webhook, and for a professional email address. Cloudflare Registrar sells at cost.
2. **Buy a toll-free number in Twilio and submit Toll-Free Verification (TVC).** Unverified toll-free numbers are heavily filtered and volume-capped. Full steps are in `A2P_NOTES.md`. Expect 1–2 business days.
3. **Point the Twilio webhook at the Worker.** Change `PUBLIC_URL` in `wrangler.toml` **and** the Twilio webhook URL together — signature validation is ON and computed over that exact URL. Until `api.stayxi.com` exists, keep the current `workers.dev` URL in both places.
4. **Connect a Google account for outreach.** Admin → Leads → Connect Google account (see `bot/README.md` for the Google Cloud + `wrangler secret` steps). Follow-ups are manual by design.
5. **Worker secrets.** Already set: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `OPENROUTER_API_KEY`, `ADMIN_PASSWORD` (verified working). Still missing for outreach: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_FROM_EMAIL`, `GMAIL_MAILING_ADDRESS`. Two secrets are set but not referenced by the current code — `TWILIO_MESSAGING_SERVICE_SID` and `VAULT_KEY`. `GET /health` and the Operations tab tell you what is still missing.

---

## 3. Business email — the cheapest sane path

You asked for the best *free* way. The honest answer splits into two parts: **receiving** is free, and **sending as your own domain** is nearly free but needs the domain.

**Options, cheapest first:**

| Option | Cost | Receive? | Send as `hello@stayxi.com`? | Works with the code's Gmail API? |
|---|---|---|---|---|
| Forward to a free Gmail | $0 + domain | Yes (forward only) | Only via Gmail "Send mail as" | Yes, from the Gmail address |
| **Cloudflare Email Routing** | $0 + domain | Yes, unlimited forwarding | No (receive-only) | No |
| **Zoho Mail free plan** | $0 + domain | Yes, full mailbox | Yes (up to 5 users) | Via Gmail "Send mail as" using Zoho SMTP |
| Google Workspace | ~$6/user/mo + domain | Yes | Yes, natively | Yes — no extra setup |

**Recommended path:**

1. **Buy `stayxi.com` regardless** — you need it for the site and the SMS endpoint, so it is not an email-specific cost.
2. **Start with a free Google account + Zoho Mail free plan:**
   - Create the mailbox `hello@stayxi.com` on Zoho's free plan.
   - In that Google account, add `hello@stayxi.com` under **Settings → Accounts → "Send mail as"** so replies go out under your brand.
   - Connect that Google account in Admin → Leads. The existing send flow will then send as your brand.
3. **Move to Google Workspace (~$6/mo) the moment a pilot is paying.** It removes the "Send mail as" relay and DKIM caveats and just works with the code.

**Two cautions that matter more than the tooling:**

- **Deliverability.** Cold email from a brand-new domain or a free Gmail lands in spam. Warm the address up, send in small personalized batches, and always include the unsubscribe link and mailing address the Worker already appends.
- **Google's terms.** Bulk cold email through a free Gmail can get the account restricted. The project deliberately keeps outreach one-to-one and manual — keep it that way.

---

## 4. Lead list and outreach status

`bot/leads.js` is the single source of truth. Rules (enforced by `bot/leads.test.js`):

- Only real businesses with an official site and a published phone.
- `email` is set **only** when a business email is published on the company's own site; every such entry carries `emailSource` and `emailCheckedAt`.
- Never guess an email from a domain or company name.

**Currently 12 of 49 leads have a verified public email** (re-checked 2026-10-26): Orlando Rent A Villa, Global Vacation Rentals, Florida Spirit Vacation Homes, Casiola, Florida Vacation Homes, Orlando Vacation Homes, Homes4uu, RealJoy Vacations, Stay on 30A, The Listing Tampa, Holiday Isle Properties, and Vacation Rentals Florida.

Most of the remaining operators publish **no email at all** — they use a contact form, or obfuscate the address (`name(at)domain(dotted)com`). That is a deliberate anti-automation signal, so reaching those leads means their published phone or web form, not a scraped address.

One lead (Florida Realty Marketplace) was **removed** because its public contact page asks not to be contacted with solicitations. Honor signals like that rather than working around them. Some sites also publish their email only in an obfuscated form (for example `info(at)example(dotted)com`); those were left out as an anti-automation signal — add them only if you judge it appropriate.

**To verify the rest:** open the company's own `/contact` page, and only add an address you can see there. Record the source URL and the date. If there is no published email, use the published phone or the site's contact form instead — or drop the lead.

**Fit matters more than count.** The list is tagged `fit` A/B/C. Fit **A** (independent Central-Florida operators) is the real target for a $49 one-property pilot; fit **C** (national firms like Vacasa, VTrips, FirstService) will almost never respond to a pilot this small. Spend your outreach hours on fit A and B. Thirty well-researched fit-A leads will outperform all fifty mixed ones.

The admin Leads tab now has a **"With verified email" filter** and a live count, so you can work only the leads you can actually contact.

---

## 5. Repo hygiene (done this pass)

- Deleted fabricated-data scratch files (`new_leads.json`, `r_leads.json`, `r_new_leads.json`, `r_leads_new.json`, `r_analytics.json`, `r_properties.json`) — they contained invented `555` numbers and guessed emails.
- Removed the stale `site/admin.html` (it referenced a deleted file and was superseded by the admin panel inside the Worker).
- Moved the legacy admin build helpers and old-brand copy to `drafts/legacy-admin/`.

---

## 6. Recommended order of operations

1. `npm test` — confirm green.
2. Buy `stayxi.com`; add to Cloudflare; point the Pages site at it.
3. Set up `hello@stayxi.com` and a Google account to send from (§3).
4. Buy + verify the toll-free number; wire the webhook (§2).
5. Configure one real property end-to-end in the admin panel and text it yourself.
6. Send **five** reviewed, personalized pitches to fit-A leads — not fifty.
7. Review replies, tune the pitch, then repeat.
