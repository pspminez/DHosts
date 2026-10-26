export type RiskLevel = "low" | "high" | "emergency";
export type RouteAction = "answer" | "ai" | "emergency" | "escalate" | "clarify" | "off_topic";

export interface PropertyKnowledge {
  secrets?: { topic?: string; keywords: string[]; reply: string }[];
  answers?: { topic?: string; keywords: string[]; reply: string }[];
}

export interface RoutePlan {
  action: RouteAction;
  risk: RiskLevel;
  intentKey: string;
  answer?: { text: string; secret: boolean; topic: string };
}

export function matchKnownAnswer(body: string, property: PropertyKnowledge): RoutePlan["answer"] | null;
export function planGuestMessage(body: string, property: PropertyKnowledge): RoutePlan;
