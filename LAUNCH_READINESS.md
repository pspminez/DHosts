# StayXI — Launch Readiness

_Status snapshot: 2026-10-26. This is an operating checklist, not legal or financial advice._

This file answers one question: **what is actually left before StayXI can take a paying pilot property?** Everything below is either *built*, *blocked on a purchase/credential only you can provide*, or *still to do*. Be honest with yourself about which column each item is in before spending money.

---

## 1. What is built and working today

| Piece | Where | State |
|---|---|---|
| Guest SMS bot (webhook, routing, escalation, STOP/HELP) | `bot/worker.ts` | Working, `npm test` = 69/69 pass |
| Property answer library + secrets (gate codes) | D1 + `PROPERTIES` KV | Working |
| Admin panel (Properties / Leads / Analytics / Operations / Pilot) | inlined in `bot/worker.ts` | Deployed; health endpoint returns `ok`, Pilot markup is present, and pilot APIs return 401 without a session |
| Pilot setup, launch gates, and persistent scorecards | Pilot tab + D1 migration `0007_pilot_properties.sql` | Deployed and locally exercised end-to-end; launch/scorecard audit events record field names and outcomes, not scorecard contents |
| Pilot activity viewer | Pilot tab + authenticated `pilot-audit` API | Implemented in source and locally tested; deploy Worker before it is available in production. Shows aggregate counts/event metadata only, never scorecard answers or notes |
| Read-only production smoke check | `npm run check:production` | Implemented and validated against local Wrangler; requires the admin password and the updated Worker deployment for a production pass. GET-only; does not mutate D1 or KV |
| Pilot integration monitoring | `admin_audit_log` | Launch, completion, and scorecard-save events are auditable without recording scorecard contents; external alerts and dashboards are not configured |
| One-to-one Gmail outreach (send-only, unsubscribe, suppression) | admin Leads tab | Built, **not connected** (needs Google OAuth) |
| Marketing site | `site/index.html`, `privacy.html`, `terms.html` | Ready to deploy to Pages |
| Pilot program + terms | `PILOT_PROGRAM.md` | Written |
| Lead list | `bot/leads.js` | Re-checked 2026-10-26; **5 of 8 have a verified public email** |

Run `npm run typecheck`, `npm run check:ui`, and `npm test` to confirm the Worker types, dashboard wiring, pilot-flow integration, and lead-data rules before a deploy.

---

## 2. Blockers before a single guest can text you

The Worker and Pilot panel are deployed and have been exercised with local test data. **All current property records are test/demo properties; there are no real operator properties or live pilot results yet.** Test/demo data is not evidence that an operator's guest-facing setup is ready. These are the remaining real-world gates:

1. **Confirm the domain and public contact channels.** The Worker currently uses its `workers.dev` hostname; configure `stayxi.com`, `api.stayxi.com`, and the public site before presenting a branded guest line. Change `PUBLIC_URL` and the Twilio webhook together only after the custom endpoint is configured, because signatures depend on an exact URL match.
2. **Verify the actual Twilio number and messaging registration.** The repository notes an earlier rejected A2P 10DLC attempt and describes a toll-free path, but do not assume a toll-free number was purchased or approved. The configured Twilio secret names and a `workers.dev` webhook in `wrangler.toml` do not prove number ownership, SMS capability, Toll-Free Verification/A2P approval, or the webhook saved in Twilio Console. The account owner must check the exact number and inbound Messaging Service/number configuration in Twilio Console and confirm its POST URL exactly matches `PUBLIC_URL` before any real pilot traffic.
3. **Run a controlled operator test before guest use.** Use the Admin simulation first (no AI, SMS, or log writes). Then, with operator consent and a controlled phone, verify an approved routine reply, unsupported-question escalation, host reply routing, HELP, and STOP. Do not activate a test record on a number used by guests.
4. **Confirm written pilot terms and privacy/SMS notice.** Agree on property, dates, fee/payment, escalation expectations, operator contact, data responsibilities, and pause procedure. Explain SMS and pilot trend review; use the applicable current Privacy Policy and SMS terms.
5. **Connect Gmail only if using email outreach.** Google OAuth and sender/mail fields must be configured and checked by the account owner before outreach. Outreach can remain manual/offline.
6. **Check operations without exposing secret values.** `GET /health` checks D1/KV availability only. The authenticated Operations health endpoint reports configured-secret presence and active properties missing host/text numbers; it does not prove number registration, deliverability, contractual readiness, or host availability.

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

**Currently 5 of the 8 checked leads have a verified public email** (re-checked 2026-10-26): Orlando Rent A Villa, Florida Spirit Vacation Homes, FunStay Florida, Grand Welcome of Greater Orlando, and RevaVista Vacation Homes.

The other three — Reunion Vacation Homes, McCormack Realty, and An Owners Dream Management — publish **no owner-facing email**: their official contact pages list phone lines, an office address, and a web form. An Owners Dream's public Visit Central Florida listing does show a reservation inbox, but that is guest-facing, so it is deliberately not used for outreach. Reaching these leads means their published phone or their site's form, not a scraped address.

One lead (Florida Realty Marketplace) was **removed** because its public contact page asks not to be contacted with solicitations. Honor signals like that rather than working around them. Some sites also publish their email only in an obfuscated form (for example `info(at)example(dotted)com`); those were left out as an anti-automation signal — add them only if you judge it appropriate.

**To verify the rest:** open the company's own `/contact` page, and only add an address you can see there. Record the source URL and the date. If there is no published email, use the published phone or the site's contact form instead — or drop the lead.

**Fit matters more than count.** The list is tagged `fit` A/B/C. Fit **A** (independent Central-Florida operators) is the real target for a $49 one-property pilot; fit **C** (national firms like Vacasa, VTrips, FirstService) will almost never respond to a pilot this small. Spend your outreach hours on fit A and B. Six of the eight checked leads are fit A; a handful of well-researched fit-A operators will outperform a long mixed list.

The admin Leads tab now has a **"With verified email" filter** and a live count, so you can work only the leads you can actually contact.

---

## 5. Repo hygiene (done this pass)

- Deleted fabricated-data scratch files (`new_leads.json`, `r_leads.json`, `r_new_leads.json`, `r_leads_new.json`, `r_analytics.json`, `r_properties.json`) — they contained invented `555` numbers and guessed emails.
- Removed the stale `site/admin.html` (it referenced a deleted file and was superseded by the admin panel inside the Worker).
- Moved the legacy admin build helpers and old-brand copy to `drafts/legacy-admin/`.

---

## 6. Recommended order of operations

1. `npm test` — confirm green; run `npm run check:production` with `STAYXI_ADMIN_PASSWORD` set for read-only deployed checks.
2. Rehearse Pilot setup and blocked launch checks using only an inactive test/demo property. Do not count fixture activity as operator usage, pilot results, or evidence of willingness to pay.
3. Complete the domain, Twilio number registration/routing, written operator agreement, privacy/SMS notice, escalation-contact, and pause-procedure gates in §2.
4. Onboard the first real operator property only after operator approval. With consent, test the line from a controlled phone: supported answer, unsupported escalation, host reply, HELP, and STOP.
5. Confirm no test code or sample data is in the real property's guest-facing knowledge, messages, or configuration before sharing its number with guests.
6. Only after the first operator setup is approved, decide whether to contact a small number of fit-A leads. Keep outreach individually reviewed and respect the prospect's stated contact preferences.
7. Review actual operator results and incidents weekly; pause guest traffic after any critical access, safety, or privacy error until investigated and explicitly cleared.
