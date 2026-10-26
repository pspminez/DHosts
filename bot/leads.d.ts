export interface Lead {
  id: string;
  name: string;
  location: string;
  phone: string;
  website: string;
  address: string;
  email: string;
  emailSource: string;
  emailCheckedAt: string;
  emailNote: string;
  pitchSource: string;
  pitchCheckedAt: string;
  contactName: string;
  sources: string[];
  fit: "A" | "B" | "C";
  confidence: "High" | "Medium";
  propertyType: string;
  scriptTopic: string;
  clientType: string;
  leadStatus: string;
  pitchEmail: { subject: string; body: string };
  pitchPhone: string;
  followUpEmail: { subject: string; body: string };
}

export const LEADS: Lead[];
