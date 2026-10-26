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
  // --- Fit A: independent / small Central Florida operators ---
  ["orlando-rent-a-villa", "Orlando Rent A Villa", "Davenport", "863-420-3332", "https://www.orlandorentavilla.com/", "Davenport, FL", "A", ["https://www.orlandorentavilla.com/", "https://www.orlandorentavilla.com/contact-us/"]],
  ["global-vacation-rentals", "Global Vacation Rentals", "Winter Garden", "407-387-3030", "https://www.globalresorthomes.com/", "12601 Avalon Road, Winter Garden, FL 34787", "A", ["https://www.globalresorthomes.com/", "https://www.globalresorthomes.com/contact/"]],
  ["florida-spirit-vacation-homes", "Florida Spirit Vacation Homes", "ChampionsGate", "407-396-4441", "https://www.floridaspiritvacationhome.com/", "1503 Legends Blvd., ChampionsGate, FL 33896", "A", ["https://www.floridaspiritvacationhome.com/", "https://www.floridaspiritvacationhome.com/contact-us/"]],
  ["magical-vacation-homes", "Magical Vacation Homes", "Davenport", "407-891-4323", "https://www.magicalvacationhomes.com/", "7555 Osceola Polk Line Rd., Davenport, FL 33896", "A", ["https://www.magicalvacationhomes.com/", "https://www.magicalvacationhomes.com/contact/"]],
  ["florida-vacation-homes", "Florida Vacation Homes", "Davenport", "407-988-0710", "https://www.floridavacationhomes.com/", "7535 Osceola Polk Line Rd., Davenport, FL 33896", "A", ["https://www.floridavacationhomes.com/", "https://www.floridavacationhomes.com/contact/"]],
  ["orlando-vacation-homes", "Orlando Vacation Homes", "Davenport", "877-866-7368", "https://www.orlandovacationhomes.com/", "7569 Osceola Polk Line Rd., Davenport, FL 33896", "A", ["https://www.orlandovacationhomes.com/", "https://www.orlandovacationhomes.com/about-us/contact-information/"]],
  ["homes4uu", "Homes4uu", "Kissimmee", "877-228-6357", "https://www.homes4uu.com/", "Kissimmee / Disney area, FL", "A", ["https://www.homes4uu.com/", "https://www.homes4uu.com/contact-us/"]],
  ["tropical-escape-vacation-homes", "Tropical Escape Vacation Homes", "Orlando", "866-409-8598", "https://www.tropicalescapevacationhomes.com/", "Orlando, FL", "A", ["https://www.tropicalescapevacationhomes.com/", "https://www.tropicalescapevacationhomes.com/property-management/contact-us/"]],
  ["vacation-rentals-florida", "Vacation Rentals Florida", "Orlando", "407-326-0370", "https://www.vacationrentalsflorida.com/", "Orlando, FL", "A", ["https://www.vacationrentalsflorida.com/"]],

  // --- Fit B: regional Florida operators ---
  ["casiola", "Casiola", "Orlando", "800-464-4104", "https://www.casiola.com/", "Orlando, FL", "B", ["https://www.casiola.com/", "https://www.casiola.com/contact/"]],
  ["rentyl-resorts", "Rentyl Resorts", "Orlando", "321-888-3509", "https://www.rentylresorts.com/", "Orlando, FL", "B", ["https://www.rentylresorts.com/"]],
  ["top-villas", "Top Villas", "Orlando", "407-495-2595", "https://www.topvillas.com/", "Orlando, FL", "B", ["https://www.topvillas.com/"]],
  ["sunhost-resorts", "SunHost Resorts", "Madeira Beach", "800-997-1457", "https://www.sunhostresorts.com/", "Madeira Beach, FL", "B", ["https://www.sunhostresorts.com/"]],
  ["resort-rentals", "Resort Rentals", "St. Pete Beach", "727-363-3336", "https://www.resortrentals.us/", "St. Pete Beach, FL", "B", ["https://www.resortrentals.us/"]],
  ["southern-vacation-rentals", "Southern Vacation Rentals", "Gulf Breeze", "800-406-5714", "https://www.southernresorts.com/", "Gulf Breeze, FL", "B", ["https://www.southernresorts.com/"]],
  ["royal-destinations", "Royal Destinations", "Santa Rosa Beach", "850-534-0841", "https://www.royaldestinations.com/", "Santa Rosa Beach, FL", "B", ["https://www.royaldestinations.com/"]],
  ["realjoy-vacations", "RealJoy Vacations", "Destin", "850-974-0974", "https://www.realjoy.com/", "1008 Airport Rd STE F, Destin, FL 32541", "B", ["https://www.realjoy.com/", "https://www.realjoy.com/realjoy-contact-us"]],
  ["ocean-reef-resorts", "Ocean Reef Resorts", "Destin", "800-782-8736", "https://www.oceanreefresorts.com/", "Destin, FL", "B", ["https://www.oceanreefresorts.com/"]],
  ["holiday-isle-properties", "Holiday Isle Properties", "Destin", "800-837-5102", "https://www.holidayisle.net/", "Destin, FL", "B", ["https://www.holidayisle.net/"]],
  ["newman-dailey-resort-properties", "Newman-Dailey Resort Properties", "Destin", "850-837-1071", "https://www.destinvacation.com/", "Destin, FL", "B", ["https://www.destinvacation.com/"]],
  ["benchmark-management", "Benchmark Management", "Santa Rosa Beach", "850-745-4555", "https://www.benchmark30a.com/", "Santa Rosa Beach, FL", "B", ["https://www.benchmark30a.com/"]],
  ["stay-on-30a", "Stay on 30A", "Santa Rosa Beach", "850-739-1365", "https://www.stayon30a.com/", "Santa Rosa Beach, FL", "B", ["https://www.stayon30a.com/"]],
  ["best-beach-getaways", "Best Beach Getaways", "Panama City Beach", "888-567-5150", "https://www.bestbeachgetaways.com/", "Panama City Beach, FL", "B", ["https://www.bestbeachgetaways.com/"]],
  ["panhandle-getaways", "Panhandle Getaways", "Panama City Beach", "850-588-8125", "https://www.panhandlegetaways.com/", "Panama City Beach, FL", "B", ["https://www.panhandlegetaways.com/"]],
  ["royal-shell", "Royal Shell", "Fort Myers", "866-341-7799", "https://www.royalshell.com/", "Fort Myers, FL", "B", ["https://www.royalshell.com/"]],
  ["naples-vacation-properties", "Naples Vacation Properties", "Naples", "239-206-3375", "https://www.naplesvacationproperties.com/", "Naples, FL", "B", ["https://www.naplesvacationproperties.com/"]],
  ["siesta-key-luxury-rental-properties", "Siesta Key Luxury Rental Properties", "Sarasota", "941-349-1125", "https://www.siestakeyluxuryrentalproperties.com/", "Sarasota, FL", "B", ["https://www.siestakeyluxuryrentalproperties.com/"]],
  ["anna-maria-island-accommodations", "Anna Maria Island Accommodations", "Holmes Beach", "941-779-0733", "https://www.annamariaislandaccommodations.com/", "Holmes Beach, FL", "B", ["https://www.annamariaislandaccommodations.com/"]],
  ["beachside-management", "Beachside Management", "Siesta Key", "941-203-8058", "https://www.beachsidemanagement.com/", "Siesta Key, FL", "B", ["https://www.beachsidemanagement.com/"]],
  ["sand-key-realty", "Sand Key Realty", "Clearwater", "727-443-0032", "https://www.sandkey.com/", "Clearwater, FL", "B", ["https://www.sandkey.com/"]],
  ["rent-key-west-vacations", "Rent Key West Vacations", "Key West", "800-833-7368", "https://www.rentkeywest.com/", "Key West, FL", "B", ["https://www.rentkeywest.com/"]],
  ["last-key-realty", "Last Key Realty", "Key West", "305-292-6266", "https://www.lastkeyrealty.com/", "Key West, FL", "B", ["https://www.lastkeyrealty.com/"]],
  ["key-west-hideaways", "Key West Hideaways", "Key West", "305-296-9090", "https://www.keywesthideaways.com/", "Key West, FL", "B", ["https://www.keywesthideaways.com/"]],
  ["florida-rental-by-owners", "Florida Rental By Owners", "Bradenton", "877-735-2726", "https://www.floridarentalbyowners.com/", "Bradenton, FL", "B", ["https://www.floridarentalbyowners.com/"]],
  // Florida Realty Marketplace (Lakeland) was removed: its contact page asks not to be
  // contacted with solicitations, so it is excluded from outreach.
  ["watson-realty", "Watson Realty Corp.", "Jacksonville", "866-243-8193", "https://www.watsonrealtycorp.com/", "Jacksonville, FL", "B", ["https://www.watsonrealtycorp.com/"]],
  ["rent-with-integrity", "Rent with Integrity", "Tallahassee", "850-778-2010", "https://www.rentwithintegrity.com/", "Tallahassee, FL", "B", ["https://www.rentwithintegrity.com/"]],
  ["tampa-property-management", "The Listing Tampa", "Tampa", "813-796-5200", "https://www.tampapropertymanagement.net/", "401 E. Jackson St. Suite 3300, Tampa, FL 33602", "B", ["https://www.tampapropertymanagement.net/", "https://tampapropertymanagement.net/contact-us/"]],
  ["homevest", "Homevest", "Orlando", "407-897-5400", "https://www.homevest.com/", "Orlando, FL", "B", ["https://www.homevest.com/"]],
  ["the-realty-medics", "The Realty Medics", "Orlando", "321-947-7653", "https://www.therealtymedics.com/", "Orlando, FL", "B", ["https://www.therealtymedics.com/"]],

  // --- Fit C: large national / institutional operators (low priority) ---
  ["vacasa-orlando", "Vacasa", "Orlando", "800-544-0300", "https://www.vacasa.com/", "Orlando, FL", "C", ["https://www.vacasa.com/", "https://www.vacasa.com/usa/Florida/Orlando"]],
  ["vtrips", "VTrips", "St. Augustine", "844-334-4588", "https://www.vtrips.com/", "St. Augustine, FL", "C", ["https://www.vtrips.com/"]],
  ["firstservice-residential", "FirstService Residential", "Miami", "855-333-5149", "https://www.fsresidential.com/", "Miami, FL", "C", ["https://www.fsresidential.com/"]],
  ["kw-property-management", "KW Property Management & Consulting", "Miami", "305-476-9188", "https://www.kwpmc.com/", "Miami, FL", "C", ["https://www.kwpmc.com/"]],
  ["campbell-property-management", "Campbell Property Management", "Boca Raton", "954-427-8770", "https://www.campbellpropertymanagement.com/", "Boca Raton, FL", "C", ["https://www.campbellpropertymanagement.com/"]],
  ["all-county-medallion", "All County Medallion Property Management", "Fort Myers", "239-204-4171", "https://www.allcountymedallion.com/", "Fort Myers, FL", "C", ["https://www.allcountymedallion.com/"]],
  ["tricon-residential", "Tricon Residential", "Miami", "844-874-2661", "https://www.triconresidential.com/", "Miami, FL", "C", ["https://www.triconresidential.com/"]],
  ["wrightdavis-property-management", "WrightDavis Property Management", "Tampa", "813-251-0001", "https://www.wrightdavis.com/", "Tampa, FL", "C", ["https://www.wrightdavis.com/"]],
  ["rent-solutions", "Rent Solutions", "Tampa", "813-579-5597", "https://www.rentsolutions.com/", "Tampa, FL", "C", ["https://www.rentsolutions.com/"]],
  ["sentry-management", "Sentry Management", "Longwood", "844-550-0336", "https://www.sentrymgt.com/", "Longwood, FL", "C", ["https://www.sentrymgt.com/"]],
];

// Business emails published on the company's own site, re-checked 2026-10-26.
// Only add an entry after opening the source page and seeing the address there.
const publicContacts = {
  "orlando-rent-a-villa": {
    email: "lloyd@orlandorentavilla.com",
    contactName: "Lloyd",
    source: "https://www.orlandorentavilla.com/contact-us/",
    checkedAt: "2026-10-26",
    note: "Listed as the property-management contact; the general inbox is info@orlandorentavilla.com.",
  },
  "global-vacation-rentals": {
    email: "hello@globalfl.com",
    source: "https://www.globalresorthomes.com/contact/",
    checkedAt: "2026-10-26",
  },
  "florida-spirit-vacation-homes": {
    email: "info@floridaspirit.com",
    source: "https://www.floridaspiritvacationhome.com/contact-us/",
    checkedAt: "2026-10-26",
  },
  "casiola": {
    email: "info@casiola.com",
    source: "https://www.casiola.com/contact/",
    checkedAt: "2026-10-26",
  },
  "florida-vacation-homes": {
    email: "rentals@floridavacationhomes.com",
    source: "https://www.floridavacationhomes.com/contact/",
    checkedAt: "2026-10-26",
  },
  "orlando-vacation-homes": {
    email: "info@orlandovacationhomes.com",
    source: "https://www.orlandovacationhomes.com/about-us/contact-information/",
    checkedAt: "2026-10-26",
  },
  "homes4uu": {
    email: "kristyn.homes4uu@gmail.com",
    contactName: "Kristyn",
    source: "https://www.homes4uu.com/contact-us/",
    checkedAt: "2026-10-26",
  },
  "realjoy-vacations": {
    email: "stay@realjoy.com",
    source: "https://www.realjoy.com/realjoy-contact-us",
    checkedAt: "2026-10-26",
  },
  "stay-on-30a": {
    email: "propertymanagement@stayon30a.com",
    source: "https://stayon30a.com/contact-us",
    checkedAt: "2026-10-26",
    note: "Listed under Property Management; the guest/vacation inbox is vacations@stayon30a.com.",
  },
  "tampa-property-management": {
    email: "info@thelistingrem.com",
    source: "https://tampapropertymanagement.net/contact-us/",
    checkedAt: "2026-10-26",
    note: "The site now brands as The Listing Tampa; this is the address published on its contact page.",
  },
  "holiday-isle-properties": {
    email: "customersupport@holidayisle.net",
    source: "https://www.holidayisle.net/contact-us",
    checkedAt: "2026-10-26",
  },
};

export const LEADS = prospects.map(([id, name, location, phone, website, address, fit, sources]) => {
  const contact = publicContacts[id] || {};
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
    confidence: fit === "C" ? "Medium" : "High",
    propertyType: "Vacation rental operator",
    scriptTopic: "vacationRental",
    clientType: "vacationRentalOperator",
    leadStatus: "new",
    pitchEmail: {
      subject: `Guest texts for ${name} — 15 minutes?`,
      body: `Hello ${name} team,

I’m [Your Name], founder of StayXI. We’re testing a guest text line for vacation rentals around Orlando and Davenport: it answers routine guest questions — check-in, checkout, Wi-Fi, gate and door codes, trash, pool heat — from answers the operator approves, and forwards anything it isn’t sure about straight to your team.

I’m inviting a small group of ${location} operators to try it on one property for 30 days — $49 flat, setup included, no auto-renewal, and no ongoing price set yet.

Would you be open to a 15-minute call about how ${name} handles routine guest questions after hours today? If someone else owns guest communications, I’d appreciate being pointed to the right public contact. And if this isn’t a fit, just let me know and I won’t follow up.

Thanks,
[Your Name]
StayXI
[Your callback number]`,
    },
    pitchPhone: `PHONE CALL SCRIPT — ${name} (${location})

1. RECEPTION / GATEKEEPER
"Hi, this is [Your Name] calling from StayXI. I’m reaching ${name} in ${location} about how your team handles routine guest questions. Could you point me to the person who oversees guest communications?"

2. WHEN CONNECTED TO THE RIGHT PERSON
"Hi [Name], this is [Your Name] with StayXI. We set up a guest text line that answers routine guest questions from information you approve and routes anything it’s unsure about to your team. I don’t want to assume how you handle this today — may I ask how routine guest questions reach you?"

3. DISCOVERY — PAUSE AND LISTEN
"Do guests text your team with recurring questions?"
"If so, which questions take the most staff time?"
"Would an automatic first reply help, or do you want every message to come straight to you?"

4. SHORT, RELEVANT EXPLANATION
"It’s configured with each property’s information. It answers the common questions and escalates everything outside that to your team. I’m running 30-day, $49 pilots with a few ${location} operators — I’d be glad to show you a quick demo so you can decide whether it fits."

5. CLOSE
"Would a 15-minute introduction next week be worthwhile? If someone else owns this area, could you share the best public way to reach them?"

6. IF THEY ARE BUSY
"Of course — when’s a better time? I can also use the contact method your company publishes."

7. IF THEY ALREADY HAVE A SYSTEM
"That makes sense; I’m not suggesting you replace what works. Is there a gap you’d want a guest-texting tool to close, or should I leave it there?"

8. IF THEY ARE NOT INTERESTED
"Understood, thanks for your time. I won’t keep you."

9. VOICEMAIL
"Hi, this is [Your Name] with StayXI, calling ${name} in ${location} about how your team handles routine guest questions by text. We run a guest text line that answers from host-approved property information and routes uncertain questions to the host. If a brief introduction would be useful, please call me back at [Your callback number]. Thanks."

CALL NOTES
- Replace the bracketed details with your name and a callback number you have verified.
- Ask permission, speak naturally, and stop if they decline.
- Never claim to know their current process, volume, software, results, or contacts before they confirm it.
- This is a prospecting script, not a promise of features beyond configured answers and escalation.`,
    followUpEmail: {
      subject: `Following up — guest texts for ${name}`,
      body: `Hello ${name} team,

Just following up on my note about StayXI, a guest text line that answers routine guest questions from your approved property information and routes the rest to your team.

I’m running 30-day, $49 pilots with a few ${location} operators — setup included, no auto-renewal. If that’s useful, I’d be glad to show you how it works. If not, no follow-up from me.

Thanks,
StayXI`,
    },
  };
});
