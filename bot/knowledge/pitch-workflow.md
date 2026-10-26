# Lead research and outreach guidance

The Admin Leads panel reads its prospect data from [`../leads.js`](../leads.js). The JSON files in this folder are property-answer or operator-reference templates; they are not the source for prospect records.

## Lead research standard

- Keep the list short and focused on independent vacation-rental operators in Davenport, Kissimmee, and greater Orlando who might realistically evaluate a one-property pilot.
- Keep only real businesses with a current official website and a published business phone. Add a street address only if an authoritative source publishes it.
- Keep URLs to the official pages supporting the prospect details. `pitchSource` and `pitchCheckedAt` identify the official page and date supporting the tailored opening fact; recheck before contact.
- Add an email only if the business itself publishes it, with `emailSource` and `emailCheckedAt`. Do not promote a guest/reservation inbox as a management contact. If only a contact form or third-party listing appears, leave `email` empty and use that channel or the published business phone.
- Treat public information as unconfirmed until rechecked at the time of contact. Do not imply you reached a decision-maker based on a published number.
- Do not invent contact details, business facts, current operations, product fit, or pain points. A public page can support a concise relevant observation, not a claim that the company needs StayXI.

The current list is a small verified starting set, not a directory or a promise that any prospect has been contacted. Each email and phone pitch should be tailored to an official-site fact and framed as a question. Some researched operators already advertise guest messaging or 24/7 support; pitches must acknowledge this and must not imply StayXI replaces their existing service.

## Pitch review

Before contact:

1. Open the linked official source and confirm the business, contact route, and tailored opening observation are still accurate.
2. Confirm that the recipient is an appropriate business contact. If the published email is generic or guest-facing, prefer the public management contact route or phone.
3. Replace `[Your Name]` and `[Your callback number]`; remove any line that does not apply. Do not send a draft containing placeholders.
4. Be transparent: StayXI is testing a $49, one-property, 30-day pilot with setup included and no automatic renewal; there is no established ongoing price. Do not claim results or features beyond the current service.
5. Start with discovery. Ask how guest questions are handled; do not present an unverified pain point as fact.
6. A follow-up draft is optional and manual. Use at most one respectful follow-up only if the recipient has not declined or opted out. Stop immediately if asked.

## Sending safeguards

- Pilot pitches are one-to-one and sent only after an operator reviews the recipient, checks the public source, personalizes the message, and explicitly confirms the send.
- Do not send when the email is missing, stale, suppressed, inappropriate for business outreach, or the prospect has declined contact. Record opt-outs with **Mark do not email** and honor unsubscribe requests.
- The Gmail connection is send-only (`gmail.send`); it does not read the mailbox. Do not send bulk campaigns or automated follow-ups.
- The Worker appends the configured mailing address and a one-click unsubscribe link. Confirm the mailing address is accurate before sending; never remove either compliance element.
- If Gmail reports uncertain delivery, check the connected mailbox's Sent folder before any retry.

## Knowledge folder safety

- `template.json` is safe to import as-is only in the sense that it contains no usable property answers: `answers` and `secrets` are empty. `answerExamples` are documentation only and are ignored by the importer. Copy reviewed examples into `answers` only after replacing every placeholder with host-confirmed facts. Never use the template to activate unverified information.
- `email-scripts.json` and `phone-scripts.json` are reference copy, not deployed product features. Do not imply that StayXI currently sends guest email or answers telephone calls. These drafts must contain no fabricated property facts, contact details, access codes, response promises, or unverified service commitments.
- Real property answer libraries may include sensitive access details. Keep them private, limited to the intended property store, and out of public examples, pitches, screenshots, and commits. Access secrets must never be guessed or sent to AI.
- Before CLI upload, prepare the private knowledge file, then use the Admin UI’s **Import knowledge JSON** for critical-item review, or stage sensitive `secrets` and critical answers through the admin workflow. A direct KV write bypasses that review and must not be used for live access information.
