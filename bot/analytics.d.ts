export const ANALYTICS_WINDOW_DAYS: number;
export const WEEKLY_BUCKETS: number;
export const WEEK_DAYS: number;
export const MIX_KEYS: string[];
export const MIX_LABELS: Record<string, string>;

export interface MixEntry {
  key: string;
  label: string;
  n: number;
  pct: number;
}

export interface DailyPoint {
  day: string;
  inbound: number;
  outbound: number;
  escalated: number;
}

export interface WeeklyBucket {
  label: string;
  inbound: number;
}

export interface PropertyShare {
  id: string;
  name: string;
  inbound: number;
  aiAnswers: number;
  escalated: number;
  lastActivity: string | null;
  pct: number;
}

export interface RecentEvent {
  kind: string;
  status: string | null;
  property: string;
  text: string;
  at: string;
}

// What the SQL returns.
export interface CommonRequestRow {
  intentKey: string;
  total: number | string | null;
}

// What the payload carries: the label travels with the count.
export interface CommonRequest {
  intentKey: string;
  label: string;
  total: number;
}

export function themeLabel(intentKey: unknown): string;

export interface AnalyticsTotals {
  inbound: number;
  outbound: number;
  answeredWithoutHuman: number | null;
  escalated: number;
  mixTotal: number;
}

export interface AnalyticsSnapshot {
  sample: boolean;
  windowDays: number;
  generatedAt: string;
  totals: AnalyticsTotals;
  deltas: { inbound: number | null; outbound: number | null };
  daily: DailyPoint[];
  weekly: WeeklyBucket[];
  mix: MixEntry[];
  properties: PropertyShare[];
  today: { inbound: number; outbound: number };
  yesterday: { inbound: number; outbound: number };
  recent: RecentEvent[];
  commonRequests: CommonRequest[];
}

export interface AnalyticsInput {
  daily: { day: string; inbound: number; outbound: number; escalated?: number }[];
  resolutions: { resolution: string | null; n: number }[];
  properties: {
    id: string;
    name: string;
    inbound: number;
    aiAnswers?: number;
    escalated?: number;
    lastActivity?: string | null;
  }[];
  recent: RecentEvent[];
  commonRequests: CommonRequestRow[];
}

export function bucketResolution(resolution: unknown): string;
export function buildMix(rows: { resolution?: string | null; n?: number | string | null }[]): MixEntry[];
export function handledWithoutHuman(mix: MixEntry[]): number | null;
export function buildDailySeries(
  rows: {
    day?: string;
    inbound?: number | string | null;
    outbound?: number | string | null;
    escalated?: number | string | null;
  }[],
  days?: number,
  now?: Date,
): DailyPoint[];
export function buildWeekly(daily: DailyPoint[], weeks?: number): WeeklyBucket[];
export function percentDelta(current: number | string, previous: number | string): number | null;
export function buildPropertyShares(
  rows: {
    id?: string;
    name?: string;
    inbound?: number | string | null;
    aiAnswers?: number | string | null;
    escalated?: number | string | null;
    lastActivity?: string | null;
  }[],
): PropertyShare[];
export function buildAnalytics(input: AnalyticsInput, now?: Date): AnalyticsSnapshot;
export function sampleAnalytics(now?: Date): AnalyticsSnapshot;
