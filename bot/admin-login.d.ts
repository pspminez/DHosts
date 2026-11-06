export const LOGIN_MAX_FAILURES: number;
export const LOGIN_WINDOW_SECONDS: number;
export const LOGIN_LOCK_SECONDS: number;

export interface LoginThrottleState {
  locked: boolean;
  failures: number;
  attemptsRemaining: number;
  retryAfterSeconds: number;
}

export function loginLock(kv: KVNamespace, ip: string, now?: number): Promise<LoginThrottleState>;
export function noteLoginFailure(kv: KVNamespace, ip: string, now?: number): Promise<LoginThrottleState>;
export function clearLoginFailures(kv: KVNamespace, ip: string): Promise<void>;
