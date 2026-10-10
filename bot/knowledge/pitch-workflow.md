# Pitch Creation Workflow

## Overview
Automated process for creating customized email and phone pitches for property management and short-term rental companies based on their location and hosts/guests needs.

## Input
- `business-leads-50.json` - 50 business leads with: name, phone, email, address, scriptTopic, clientType

## Workflow Steps

### Step 1: Load Business Leads
```json
// Load from business-leads-50.json
const leads = [
  // ... 50 lead objects with: name, phone, email, address, scriptTopic, clientType
];
```

### Step 2: Determine Property Type & Guest Needs
For each lead, determine:
- **Property type** (beach, lake, theme park, retirement community, etc.) based on location
- **Primary guest needs** (gate codes, WiFi, pool, checkout, trash, pets, quiet hours, hurricane prep)
- **Secondary amenities** (based on property type and location)

### Step 3: Generate Customized Email Pitch
Template:
```
Subject: Streamline Guest Communications for [Property Name/Location]

Hi [Contact Name],

I'm reaching out because I noticed [specific observation about their location/property type].

As a property manager in [their city/area], you likely deal with:
- Gate code inquiries from guests
- WiFi password requests
- Pool heater questions
- Checkout procedure questions
- Trash/pickup schedules
- Emergency contact needs

Our SMS bot service handles these automatically, so you only get the important stuff. Key benefits:
- 24/7 automated answers to common guest questions
- Gate codes and sensitive info never reach the AI (local KB only)
- Reduces host escalation messages by up to 90%
- Customizable for any property type (beach, lake, theme park, etc.)
- Flat monthly pricing, no per-guest fees

I'd love to show you how it works with a quick 15-minute demo.

Best regards,
Davenport Host Co. Team
[Phone: +1 (407) 555-0100]
```

Customizations per property type:
- **Beach properties**: Emphasize pool heater, beach gear, hurricane prep, parking
- **Lake/retirement communities**: Emphasize quiet hours, maintenance, emergency contacts
- **Theme park proximity**: Emphasize park tickets, transportation, early check-in/out
- **Urban/condo**: Emphasize building rules, parking, elevator usage

### Step 4: Generate Customized Phone Pitch
Template (30-45 seconds):
```
"Hi, this is [Your Name] from Davenport Host Co. We help property managers like you [specific pain point for their area] reduce the time they spend on guest calls.

For example, property managers in [their area] typically get [X] calls/week about gate codes and WiFi. Our service handles all of that automatically with local keyword matching, so your host only gets the important stuff.

It's a flat monthly fee, no per-guest charges, and setup takes less than an hour. I'd love to show you how it works - do you have 10 minutes later this week?"

Customizations per property type:
- Beach: "pool heater questions", "beach gear requests", "hurricane prep"
- Lake: "boat dock questions", "fishing license info", "quiet hours"
- Theme park: "park tickets", "transportation", "early/late check-in"
- Rural: "emergency services", "supply runs", "local recommendations"
```

### Step 5: Quality Check per Lead
For each of the 50 leads, verify:
- ✅ Email address format is valid
- ✅ Phone number has correct area code for location
- ✅ Customized pitch references their specific location
- ✅ Pitch addresses their likely guest needs based on property type
- ✅ No personal/private information included
- ✅ Professional tone appropriate for B2B outreach

### Step 6: Export for Deployment
Format leads for admin page import:
```json
[
  {
    "name": "Business Name",
    "phone": "(area) 555-xxxx",
    "email": "info@business.com",
    "pitchEmail": "Customized email text",
    "pitchPhone": "Customized phone script",
    "location": "City, FL",
    "propertyType": "beach|lake|theme|urban|rural",
    "leadStatus": "new" | "contacted" | "interested" | "closed"
  }
]
```

## Optimization Tips

1. **Batch processing**: Process 10 leads at a time to maintain quality
2. **Template library**: Create 5-7 pitch templates for different property types, then mix/match
3. **Location research**: Use first 3 digits of phone number to determine metro area, then research common property types in that area
4. **Pain point identification**: Research common complaints for property managers in their area (Google reviews, forums, etc.)
5. **A/B testing**: Create 2 pitch variants per 25 leads, test which gets better response

## Workflow Automation (Optional)
For future scale:
1. Use Python script to read business-leads-50.json
2. Call LLM API with prompt: "Create a 50-word B2B pitch for a property management company in [city] focusing on [specific needs]"
3. Output validated pitches to new field in JSON
4. Import to admin page via API

## Current Leads Status (50 total)
- 20 original leads (property mgmt across FL)
- 30 additional leads (expanded FL coverage)
- All marked as "new" status
- Ready for customized pitch generation