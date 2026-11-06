// Type declarations for host-portal.js, which worker.ts imports.

export const HOST_PASSCODE_MIN_LENGTH: number;
export const HOST_PASSCODE_MAX_LENGTH: number;
export const HOST_SESSION_DEFAULT_HOURS: number;
export const HOST_SESSION_REMEMBER_DAYS: number;
export const HOST_LOGIN_MAX_FAILURES: number;
export const HOST_LOGIN_WINDOW_SECONDS: number;
export const HOST_LOGIN_LOCK_SECONDS: number;
export const SECTION_COLORS: string[];

export interface HostRange {
  id: string;
  label: string;
  days: number;
}

export const HOST_RANGES: Record<string, HostRange>;
export function hostRange(value: unknown): HostRange;

export interface HostCredential {
  version: number;
  iterations: number;
  salt: string;
  hash: string;
  updatedAt?: string;
}

export function hashHostPasscode(passcode: string): Promise<HostCredential>;
export function hostPasscodeProblem(passcode: unknown): string;
export function loadHostPasscode(kv: KVNamespace, propertyId: string): Promise<HostCredential | null>;
export const DEFAULT_HOST_PASSCODE: string;
export function hostPortalStatus(
  kv: KVNamespace,
  propertyId: string,
): Promise<{ configured: boolean; updatedAt: string | null; defaultPasscode: boolean }>;
export function saveHostPasscode(kv: KVNamespace, propertyId: string, passcode: string): Promise<void>;
export function clearHostPasscode(kv: KVNamespace, propertyId: string): Promise<void>;
export function verifyHostPasscode(credential: HostCredential | null, passcode: string): Promise<boolean>;

export interface HostThrottleResult {
  locked: boolean;
  failures: number;
  attemptsRemaining: number;
  retryAfterSeconds: number;
}

export function hostLoginLock(
  kv: KVNamespace,
  ip: string,
  houseCode: string,
  now?: number,
): Promise<HostThrottleResult>;
export function noteHostLoginFailure(
  kv: KVNamespace,
  ip: string,
  houseCode: string,
  now?: number,
): Promise<HostThrottleResult>;
export function clearHostLoginFailures(kv: KVNamespace, ip: string, houseCode: string): Promise<void>;

export interface HostSession {
  propertyId: string;
  houseCode: string;
  hostName: string;
  createdAt: string;
}

export function hostSessionTtlSeconds(remember?: boolean): number;
export function createHostSession(
  kv: KVNamespace,
  token: string,
  record: Partial<HostSession>,
  ttlSeconds?: number,
): Promise<HostSession>;
export function getHostSession(kv: KVNamespace, token: string): Promise<HostSession | null>;
export function revokeHostSession(kv: KVNamespace, token: string): Promise<void>;
export function revokeAllHostSessions(kv: KVNamespace, propertyId: string): Promise<void>;
export function hostSessionCookie(token: string, maxAgeSeconds?: number): string;
export function hostSessionClearCookie(): string;

export interface HostGuideAnswer {
  topic: string;
  keywords: string[];
  reply: string;
}

export function normalizeHostGuide(input: unknown): HostGuideAnswer[];

export interface HostOverview {
  sample: boolean;
  range: string;
  rangeLabel: string;
  generatedAt: string;
  property: { id: string; name: string; hostName: string };
  stats: {
    inbound: number;
    answered: number;
    routed: number;
    medianReplySeconds: number | null;
    answeredPct: number;
    routedPct: number;
    sectionsUsed: number;
  };
  daily: { day: string; inbound: number }[];
  recent: { text: string; status: string; resolution: string | null; at: string; ago: string }[];
  questions: {
    text: string;
    intentKey: string;
    label: string;
    status: string;
    resolution: string | null;
    at: string;
    ago: string;
  }[];
  coverage: {
    intentKey: string;
    label: string;
    total: number;
    answered: number;
    routed: number;
    answeredPct: number;
  }[];
  guide: {
    sections: { topic: string; color: string }[];
    answers: HostGuideAnswer[];
  };
}

export function buildHostOverview(input: Record<string, unknown>, now?: Date): HostOverview;
export function sampleHostOverview(range?: string, now?: Date): HostOverview;
