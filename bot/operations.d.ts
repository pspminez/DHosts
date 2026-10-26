export interface OperationsMetrics {
  guestMessages24h: number;
  resolvedGuestMessages24h: number;
  openEscalations: number;
  escalations24h: number;
  failedHostNotifications24h: number;
  rateLimitedMessages24h: number;
  failedAI24h: number;
  aiInteractions24h: number;
  aiAnswers24h: number;
  avgAILatencyMs24h: number | null;
  avgHostResponseMinutes30d: number | null;
  measuredAt: string;
}

export interface OperationsHealth {
  database: string;
  propertyStore: string;
  twilioConfigured: boolean;
  aiConfigured: boolean;
  signatureValidationEnabled: boolean;
  missingHostPhone: number;
  missingTextNumber: number;
}

export interface AwaitingProperty {
  name: string;
  open: number;
  oldestMinutes: number | null;
}

export interface OperationsAwaiting {
  open: number;
  oldestMinutes: number | null;
  over1h: number;
  over4h: number;
  byProperty: AwaitingProperty[];
}

export interface OperationsSample {
  sample: true;
  metrics: OperationsMetrics;
  health: OperationsHealth;
  awaiting: OperationsAwaiting;
}

export function sampleOperations(now?: Date): OperationsSample;
