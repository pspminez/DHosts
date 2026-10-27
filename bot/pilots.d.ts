export const PILOT_STAGES: string[];

export interface PilotAnswer {
  topic: string;
  keywords: string[];
  reply: string;
}

export interface PilotSecret {
  keywords: string[];
  reply: string;
}

export interface PilotKnowledge {
  answers: PilotAnswer[];
  secrets: PilotSecret[];
}

export interface PilotMetricsInput {
  guestMessages?: number;
  answered?: number;
  escalated?: number;
  unrouted?: number;
  openEscalations?: number;
  avgHostReplyMinutes?: number | null;
  topIntents?: { intent: string; count: number }[];
}

export interface PilotMetrics extends Required<Omit<PilotMetricsInput, "topIntents" | "avgHostReplyMinutes">> {
  avgHostReplyMinutes: number | null;
  answeredRate: number | null;
  escalatedRate: number | null;
  unroutedRate: number | null;
  addOns: { intent: string; count: number; suggestion: string }[];
}

export function normaliseKnowledge(value: unknown): PilotKnowledge;
export function knowledgeCount(knowledge: unknown): { answers: number; secrets: number };
export function pilotCode(name: unknown, taken?: string[]): string;
export function addOnCandidates(topIntents?: { intent: string; count: number }[], limit?: number): PilotMetrics["addOns"];
export function measurePilot(input?: PilotMetricsInput): PilotMetrics;
export function canLaunchPilot(input?: {
  checklist?: Record<string, boolean>;
  startedAt?: string | null;
  endsAt?: string | null;
  now?: number;
  knowledge?: unknown;
  approvedKnowledge?: unknown;
  hasPendingChanges?: boolean;
  hasTextLine?: boolean;
  hasHostContact?: boolean;
}): boolean;
