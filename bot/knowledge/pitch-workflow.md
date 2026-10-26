# Florida Prospect List

The admin lead list is maintained in [`../leads.js`](../leads.js), which is the single source of truth used by the Worker.

## Contact-data standards

- Keep only businesses with an official website and a publicly listed business phone.
- Include a business email or street address only when it is explicitly published by an authoritative source. An empty value means it was not verified; do not infer one from a domain or company name.
- Keep source URLs with every lead so staff can recheck the listing before outreach.
- Tag each lead with a `fit` tier: **A** = independent Central-Florida operator, **B** = regional Florida operator, **C** = large national or institutional operator. Spend outreach on A and B; a $49 single-property pilot rarely lands with a national firm.
- Always set an email together with `emailSource` (the page it was published on) and `emailCheckedAt` (the date you saw it). `npm test` runs `bot/leads.test.js`, which blocks fabricated data (fictional `555` numbers, `example` or guessed emails) and any email missing its source or check date.
- Treat public listings as unconfirmed until checked at the time of contact. Do not present a listed number as proof that a person or decision-maker was reached.
- Do not use placeholder phone numbers, invented businesses, guessed emails/addresses, or claims about a prospect's needs that have not been verified.

## Outreach templates

The templates in `bot/leads.js` use only the prospect's business name and Florida market. They are starting points, not proof of a verified email contact or a claim that the business has a particular operational problem. When no email is publicly listed, use the company's official website or published phone to identify an appropriate contact before sending an email.

Review and personalize each message based on current information from the company's own website. Do not claim performance results, pricing, capabilities, or customer details unless StayXI has substantiated them.

## Sending safeguards

- Pilot pitches are one-to-one and sent only from the Admin Leads detail page after an operator reviews the recipient, checks the public source, personalizes the message, and confirms the send.
- Do not send when the email address is missing, outdated, suppressed, or the prospect has declined contact. Record verbal or written opt-outs with **Mark do not email**; honor email unsubscribe links automatically.
- The Gmail connection uses the send-only `gmail.send` scope. StayXI does not read the connected mailbox. Do not send bulk campaigns or automated follow-ups through this workflow.
- The Worker appends the configured, accurate business mailing address and a one-click unsubscribe link. Never remove either from the sent message.
- If Gmail delivery is marked uncertain, check the connected mailbox's Sent folder before any retry. Never repeat an email simply because the UI did not receive a success response.
