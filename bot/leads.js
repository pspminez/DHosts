// StayXI pilot prospect list — the single source of truth for the admin Leads tab.
//
// DATA RULES (keep these true; see bot/knowledge/pitch-workflow.md):
//   * Only real businesses with an official website and a published business phone.
//   * `email` is set ONLY when a business email is published on the company's own
//     site. Every verified email must carry `emailSource` and `emailCheckedAt`
//     (YYYY-MM-DD). Never construct an email from a domain or a company name.
//   * `sources` keeps the URL(s) staff recheck before any outreach.
//   * Treat every listing as unconfirmed until it is checked at the time of contact.
// bot/leads.test.js enforces the rules above.
//
// `fit` ranks a prospect for the $49 one-property pilot:
//   "A" — independent / small operator in Central Florida (best fit for this pilot)
//   "B" — regional Florida operator
//   "C" — large national or institutional operator (low priority for this pilot)

// [id, name, location, phone, website, address, fit, sources]
const prospects = [
  ["orlando-rent-a-villa", "Orlando Rent A Villa", "Davenport / Central Florida", "863-420-3332 ext. 7001", "https://www.orlandorentavilla.com/", "", "A", ["https://www.orlandorentavilla.com/property-management/", "https://www.orlandorentavilla.com/contact-us/"]],
  ["florida-spirit-vacation-homes", "Florida Spirit Vacation Homes", "ChampionsGate / Central Florida", "407-396-4441", "https://www.floridaspiritvacationhome.com/", "1503 Legends Blvd., ChampionsGate, FL 33896", "A", ["https://www.floridaspiritvacationhome.com/about-us/", "https://www.floridaspiritvacationhome.com/contact-us/"]],
  ["funstay-florida", "FunStay Florida", "Davenport / Central Florida", "321-430-8681", "https://www.funstayflorida.com/", "", "A", ["https://www.funstayflorida.com/property-management/", "https://www.funstayflorida.com/contact/"]],
  ["grand-welcome-greater-orlando", "Grand Welcome of Greater Orlando", "Davenport / Orlando / Kissimmee", "407-698-5870", "https://www.orlandohost.com/", "194 Laurel Ridge Pass, Davenport, FL 33897", "A", ["https://www.orlandohost.com/contact", "https://www.orlandohost.com/about"]],
  ["an-owners-dream-management", "An Owners Dream Management", "Davenport / Disney area", "863-588-3944", "https://anownersdream.com/", "", "A", ["https://anownersdream.com/aboutus.aspx", "https://anownersdream.com/contactus.aspx", "https://visitcentralflorida.org/featured/an-owners-dream-management/"]],
  ["revavista-vacation-homes", "RevaVista Vacation Homes", "Orlando / Davenport / ChampionsGate", "407-978-0478", "https://revavista.com/", "924 N Magnolia Avenue, Suite 202, Orlando, FL 32803", "A", ["https://revavista.com/contact/", "https://revavista.com/"]],
  ["reunion-vacation-homes", "Reunion Vacation Homes", "Davenport / Reunion / Kissimmee", "321-323-7810", "https://www.reunionvacationhomes.com/", "7531 Osceola Polk Line Rd, Davenport, FL 33896", "B", ["https://www.reunionvacationhomes.com/contact-us/", "https://www.reunionvacationhomes.com/property-management/"]],
  ["mccormack-realty-kissimmee", "McCormack Realty", "Kissimmee", "407-933-2367", "https://propertymanagementkissimmee.com/", "1627 E Vine St Suite 134, Kissimmee, FL 34744", "C", ["https://propertymanagementkissimmee.com/contact/"]],
];

// Business emails published on the company's own site, re-checked 2026-10-26.
// Only add an entry after opening the source page and seeing the address there.
const publicContacts = {
  "orlando-rent-a-villa": {
    email: "lloyd@orlandorentavilla.com",
    contactName: "Lloyd",
    source: "https://www.orlandorentavilla.com/contact-us/",
    checkedAt: "2026-10-26",
    note: "Official page lists Lloyd as the property-management contact; verify the address again before sending.",
  },
  "florida-spirit-vacation-homes": {
    email: "info@floridaspirit.com",
    source: "https://www.floridaspiritvacationhome.com/contact-us/",
    checkedAt: "2026-10-26",
    note: "Published general contact inbox, not a named decision-maker; confirm it is an appropriate business contact before sending.",
  },
  "funstay-florida": {
    email: "Mike@FunStayHomes.com",
    contactName: "Mike Chen",
    confidence: "Medium",
    source: "https://www.funstayflorida.com/property-management/",
    checkedAt: "2026-10-26",
    note: "Published on the property-management page with Mike Chen identified as owner. Its management page lists 321-430-8681 while the official contact page lists 503-888-8070; confirm the right contact route and number before calling.",
  },
  "grand-welcome-greater-orlando": {
    email: "hello@orlandohost.com",
    contactName: "Jay Breitlow",
    source: "https://www.orlandohost.com/contact",
    checkedAt: "2026-10-26",
    note: "Official contact page identifies Jay Breitlow as owner and operator.",
  },
  "revavista-vacation-homes": {
    email: "info@revavista.com",
    source: "https://revavista.com/contact/",
    checkedAt: "2026-10-26",
    note: "General inbox published on the official contact page next to the office phone. The page says the local team answers owners and guests around the clock, in English, French and Spanish; confirm it reaches the owner-facing team before sending.",
  },
  "reunion-vacation-homes": {
    confidence: "Medium",
    note: "No management email on the official contact page, which publishes the office address and phone lines only (321-323-7810, toll free 1-855-453-5400). Call or use the site form; do not guess an address from the domain.",
  },
  "mccormack-realty-kissimmee": {
    confidence: "Medium",
    note: "Official contact page publishes US and UK phone lines and the office address, not a management email. Owners are directed to their portal; the phone line is the appropriate first contact.",
  },
  "an-owners-dream-management": {
    confidence: "Medium",
    note: "No verified business email on its official contact page. The public Visit Central Florida listing shows reservations@anownersdream.com, which appears guest-facing; use the published phone or contact form instead of pitching that inbox. The phone number is verified from that listing, not the official site.",
  },
};

// Each draft cites one fact visible on the prospect's official site. It is an
// invitation to discovery, not a claim that the prospect has a problem or needs
// automation. Follow-ups are manual and only after the operator reviews context.
const pitches = {
  "orlando-rent-a-villa": {
    source: "https://www.orlandorentavilla.com/property-management/",
    subject: "A guest-text workflow question for Orlando Rent A Villa",
    email: `Hello Lloyd,\n\nI saw Orlando Rent A Villa describes property management across Davenport, Reunion, ChampionsGate, and Clermont, with a local team coordinating property care. I’m building StayXI, a guest-initiated text line that answers routine questions only from operator-approved information and routes uncertain questions to the team.\n\nI’m not assuming your operation has a gap. Would you be open to a 15-minute discovery conversation about how guest questions reach your team today? If there’s a fit after that, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nIf this isn’t relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `I saw Orlando Rent A Villa's property-management page lists Davenport, Reunion, ChampionsGate, and Clermont, and describes local property-care coordination. I'm calling to ask how your team currently handles routine guest questions by text—not to assume there's a problem or replace your service.`,
    followup: `Hello Lloyd,\n\nFollowing up once on my question about routine guest-text workflows. I’m looking for operator feedback, not assuming you need another tool. If a short conversation would be useful, I’d be glad to arrange one; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "florida-spirit-vacation-homes": {
    source: "https://www.floridaspiritvacationhome.com/about-us/",
    subject: "A routine guest-text question for Florida Spirit",
    email: `Hello Florida Spirit team,\n\nI read that Florida Spirit has served Central Florida since 2001 and is available seven days a week, including for urgent needs. StayXI is deliberately narrower: a guest-initiated text line for routine property questions, using information an operator approves and routing uncertainty to the team. It is not emergency coverage.\n\nI’m not assuming this would improve your existing service. Would someone on the property-management team be open to a 15-minute discovery conversation about guest-question workflows? If there’s a fit, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nIf this inbox isn’t appropriate, please point me to a public business contact—or let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `I saw Florida Spirit describes local vacation-rental management and seven-day availability, including 24/7 urgent needs. StayXI is not emergency coverage; I’m asking whether someone from property management would be willing to give feedback on a separate routine-question text workflow.`,
    followup: `Hello Florida Spirit team,\n\nFollowing up once on my question about routine guest-text workflows. I recognize your site describes existing seven-day and urgent support; I’m not proposing to replace it. If a brief discovery conversation is useful, I’d be glad to arrange one. Otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "funstay-florida": {
    source: "https://www.funstayflorida.com/property-management/",
    subject: "A guest-text workflow question for Mike at FunStay",
    email: `Hello Mike,\n\nI saw FunStay describes full-service management with guest messaging and 24/7 support. Since you already offer that, I’m not assuming there’s a problem to solve or suggesting a replacement. I’m building StayXI as a narrower text line that answers routine property questions from host-approved information and routes uncertain questions to the operator.\n\nWould you be open to a 15-minute discovery conversation and candid feedback on whether that could complement an existing operation—or simply not be useful? If there’s a fit, I’m testing one property for 30 days at $49, setup included, with no automatic renewal.\n\nIf not relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `May I speak with Mike Chen? I saw FunStay already describes full-service guest messaging and 24/7 support. I'm not calling to suggest that you lack coverage; I'm looking for an operator's candid view of a narrow, approved-answer text workflow and whether it adds anything to a service like yours.`,
    followup: `Hello Mike,\n\nFollowing up once on my note about a routine-question text workflow. I saw FunStay already offers guest messaging and 24/7 support, so I’m not assuming a need. If you’re open to a short feedback conversation, I’d appreciate it; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "grand-welcome-greater-orlando": {
    source: "https://www.orlandohost.com/contact",
    subject: "A guest-text workflow question for Grand Welcome of Greater Orlando",
    email: `Hello Jay,\n\nYour contact page describes Grand Welcome of Greater Orlando as a boutique, one-on-one vacation-rental management service for Orlando, Davenport, and Kissimmee. I’m building StayXI, a guest-initiated text line that answers routine property questions from information the operator approves and routes uncertain questions to the team.\n\nI’m not assuming your current process needs changing. Would you be open to a 15-minute discovery conversation about how routine guest questions reach your team? If there’s a fit, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nIf this isn’t relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `May I speak with Jay Breitlow? I saw Grand Welcome of Greater Orlando describes its service as boutique and one-on-one across Orlando, Davenport, and Kissimmee. I'm asking for feedback on a small guest-text workflow, not assuming you need automation or want to change your existing service.`,
    followup: `Hello Jay,\n\nFollowing up once on my question about routine guest-text workflows. I’m looking for a brief discovery conversation, not assuming your current process needs to change. If useful, I’d be glad to arrange a time; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "revavista-vacation-homes": {
    source: "https://revavista.com/contact/",
    subject: "A guest-text workflow question for RevaVista Vacation Homes",
    email: `Hello RevaVista team,\n\nYour contact page describes a local team that answers owners quickly and guests around the clock, covering Orlando, Kissimmee, Davenport, Clermont and ChampionsGate in English, French and Spanish. I’m building StayXI, a guest-initiated text line that answers routine property questions only from operator-approved information and routes anything uncertain to your team.\n\nI’m not assuming your current process needs changing. Would someone on the owner-facing side be open to a 15-minute discovery conversation about how routine guest questions reach your team today? If there’s a fit, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nIf this isn’t relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `I saw RevaVista's contact page describes a local team answering owners quickly and guests around the clock across Orlando, Kissimmee, Davenport, Clermont and ChampionsGate. I'm calling to ask how routine guest questions reach your team today—not to assume there's a problem or replace your existing service.`,
    followup: `Hello RevaVista team,\n\nFollowing up once on my question about routine guest-text workflows. I’m looking for operator feedback, not assuming you need another tool. If a short conversation would be useful, I’d be glad to arrange one; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "reunion-vacation-homes": {
    source: "https://www.reunionvacationhomes.com/property-management/",
    subject: "A guest-text workflow question for Reunion Vacation Homes",
    email: `Hello Reunion Vacation Homes team,\n\nYour property-management page describes management for Reunion Resort and nearby communities including Storey Lake, Solara, Windsor at Westside, The Retreat at Champions Gate and Formosa Gardens. I’m building StayXI, a guest-initiated text line that answers routine property questions only from operator-approved information and routes anything uncertain to your team.\n\nI’m not assuming your current process needs changing. Would someone on the management side be open to a 15-minute discovery conversation about how routine guest questions reach your team today? If there’s a fit, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nI did not find a management email on your contact page, so please treat this as a contact-form draft. If this isn’t relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `I saw Reunion Vacation Homes describes management for Reunion Resort and nearby communities including Storey Lake, Solara and Windsor at Westside. I'm calling to ask how routine guest questions reach your team and whether someone on the management side would be open to a brief discovery conversation. I'm not assuming you need another tool.`,
    followup: `Hello Reunion Vacation Homes team,\n\nFollowing up once on my question about routine guest-text workflows. I’m looking for operator feedback, not assuming you need another tool. If a short conversation would be useful, I’d be glad to arrange one; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "mccormack-realty-kissimmee": {
    source: "https://propertymanagementkissimmee.com/contact/",
    subject: "A guest-text workflow question for McCormack Realty",
    email: `Hello McCormack Realty team,\n\nYour contact page describes property management in Kissimmee with more than 30 years of experience and around 419 properties managed, and it offers owners a review comparing a vacation rental with a long-term tenancy. I’m building StayXI, a guest-initiated text line that answers routine property questions only from operator-approved information and routes anything uncertain to your team.\n\nI’m not assuming that fits how you work; much of your business is long-term, and I would rather ask than guess. Would someone who handles operations be open to a 15-minute conversation about where a text line like that would or would not help? If there’s a fit, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nI did not find a management email on your contact page, so please treat this as a contact-form draft. If this isn’t relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `I saw McCormack Realty describes property management in Kissimmee with more than 30 years of experience and around 419 properties managed. I'm calling to ask where a guest text line would or would not fit an operation like yours, rather than assuming it does.`,
    followup: `Hello McCormack Realty team,\n\nFollowing up once on my question about routine guest-text workflows. I’m looking for operator feedback, not assuming you need another tool. If a short conversation would be useful, I’d be glad to arrange one; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
  "an-owners-dream-management": {
    source: "https://visitcentralflorida.org/featured/an-owners-dream-management/",
    subject: "A guest-text workflow question for An Owners Dream Management",
    email: `Hello An Owners Dream team,\n\nI saw your public business listing describes a family-owned vacation-rental management company serving the Davenport and Disney area. I’m building StayXI, a guest-initiated text line that answers routine property questions from operator-approved information and routes uncertain questions to the team.\n\nI’m not assuming your current service needs changing. Would someone who handles property operations be open to a 15-minute discovery conversation about how guest questions reach your team? If there’s a fit, I’m testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal.\n\nI did not find a verified business email, so please use this only as a contact-form draft. If this isn’t relevant, just let me know and I won’t follow up.\n\nThanks,\n[Your Name]\nStayXI\n[Your callback number]`,
    phone: `I saw An Owners Dream Management describes itself as a family-owned vacation-rental management company serving Davenport and the Disney area. I'm calling to ask how guest questions reach the team and whether someone who handles property operations would be open to a brief discovery conversation. I'm not assuming you need a new tool.`,
    followup: `Hello An Owners Dream team,\n\nFollowing up once on my question about routine guest-text workflows. I’m looking for operator feedback, not assuming you need another tool. If a short conversation would be useful, I’d be glad to arrange one; otherwise, I won’t follow up again.\n\nThanks,\n[Your Name]\nStayXI`,
  },
};

export const LEADS = prospects.map(([id, name, location, phone, website, address, fit, sources]) => {
  const contact = publicContacts[id] || {};
  const pitch = pitches[id];
  if (!pitch) throw new Error(`Missing tailored pitch for ${id}`);
  return {
    id,
    name,
    location,
    phone,
    website,
    address,
    sources,
    fit,
    email: contact.email || "",
    contactName: contact.contactName || "",
    emailSource: contact.source || "",
    emailCheckedAt: contact.checkedAt || "",
    emailNote: contact.note || "",
    pitchSource: pitch.source,
    pitchCheckedAt: "2026-10-26",
    confidence: contact.confidence || "High",
    propertyType: "Vacation rental operator",
    scriptTopic: "vacationRental",
    clientType: "vacationRentalOperator",
    leadStatus: "new",
    pitchEmail: { subject: pitch.subject, body: pitch.email },
    pitchPhone: `CALL CONTEXT: ${name} (${location})\n\n${pitch.phone}\n\nDiscovery: Ask how routine guest questions arrive today and what happens when the team is busy. Listen before describing the offer. Do not imply the business has a problem.\n\nIf invited: StayXI is testing a one-property, 30-day pilot for $49, setup included, with no automatic renewal. Ask whether a brief demo would be useful.\n\nIf declined: Thank them and stop. Never leave a voicemail or send a follow-up if they ask not to be contacted.\n\nBefore contact: Recheck the official source links and current phone number. Replace [Your Name] and [Your callback number] in any email draft.`,
    followUpEmail: { subject: `Following up — ${name} guest-text workflow question`, body: pitch.followup },
  };
});
