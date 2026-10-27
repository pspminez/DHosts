export const INSIGHTS_WINDOW_DAYS: number;

export interface InsightTheme {
  key: string;
  label: string;
  total: number;
  share: number;
  escalated: number;
  unresolved: number;
  needsHuman: number;
  deltaPct: number | null;
}

export interface InsightUnanswered {
  key: string;
  label: string;
  total: number;
  needsHuman: number;
  escalated: number;
  unresolved: number;
  shareOfTheme: number;
}

export interface InsightProperty {
  name: string;
  total: number;
  needsHuman: number;
  share: number;
  needsHumanShare: number;
}

export interface InsightDailyPoint {
  day: string;
  inbound: number;
  outbound: number;
  escalated: number;
}

export interface InsightWeeklyBucket {
  label: string;
  inbound: number;
}

export interface InsightsSnapshot {
  sample: boolean;
  windowDays: number;
  generatedAt: string;
  totals: {
    messages: number;
    themes: number;
    needsHuman: number;
    needsHumanShare: number | null;
  };
  themes: InsightTheme[];
  unanswered: InsightUnanswered[];
  properties: InsightProperty[];
  daily: InsightDailyPoint[];
  weekly: InsightWeeklyBucket[];
}

export interface InsightsInput {
  current: { intentKey?: string | null; total?: number | string | null; escalated?: number | string | null; unresolved?: number | string | null }[];
  previous: { intentKey?: string | null; total?: number | string | null }[];
  properties: { name?: string | null; total?: number | string | null; unresolved?: number | string | null }[];
  daily?: { day?: string; inbound?: number | string | null; outbound?: number | string | null; escalated?: number | string | null }[];
}

export function themeLabel(intentKey: unknown): string;
export function buildInsights(input: InsightsInput, now?: Date): InsightsSnapshot;
export function sampleInsights(now?: Date): InsightsSnapshot;
