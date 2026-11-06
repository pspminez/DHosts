export const ADMIN_SESSION_DEFAULT_HOURS: number;
export const ADMIN_SESSION_REMEMBER_DEFAULT_DAYS: number;
export const ADMIN_SESSION_TTL_SECONDS: number;
export const ADMIN_SESSION_REMEMBER_TTL_SECONDS: number;
export interface AdminSessionConfig {
  ADMIN_SESSION_HOURS?: string;
  ADMIN_SESSION_REMEMBER_DAYS?: string;
}
export function adminSessionTtlSeconds(config?: AdminSessionConfig, remember?: boolean): number;
export function randomSessionToken(): string;
export function hashSessionToken(token: string): Promise<string>;
export interface AdminSessionMeta {
  id?: string;
  createdAt?: string;
  ip?: string;
  userAgent?: string;
}
export interface AdminSessionInfo {
  key: string;
  id: string;
  current: boolean;
  createdAt: string | null;
  ip: string;
  userAgent: string;
  legacy: boolean;
}
export function createAdminSession(
  kv: KVNamespace,
  token: string,
  meta?: AdminSessionMeta,
  ttlSeconds?: number,
): Promise<void>;
export function adminSessionValid(kv: KVNamespace, token: string): Promise<boolean>;
export function revokeAdminSession(kv: KVNamespace, token: string): Promise<void>;
export function listAdminSessions(kv: KVNamespace, currentToken: string): Promise<AdminSessionInfo[]>;
export function revokeAdminSessionById(
  kv: KVNamespace,
  id: string,
  currentToken: string,
): Promise<{ revoked: boolean; current: boolean }>;
export function adminSessionSetCookie(token: string, maxAgeSeconds?: number): string;
export function adminSessionClearCookie(): string;
export function getCookieValue(cookieHeader: string, name: string): string;
