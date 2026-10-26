export const ADMIN_SESSION_TTL_SECONDS: number;
export function randomSessionToken(): string;
export function hashSessionToken(token: string): Promise<string>;
export function createAdminSession(kv: KVNamespace, token: string): Promise<void>;
export function adminSessionValid(kv: KVNamespace, token: string): Promise<boolean>;
export function revokeAdminSession(kv: KVNamespace, token: string): Promise<void>;
export function adminSessionSetCookie(token: string): string;
export function adminSessionClearCookie(): string;
export function getCookieValue(cookieHeader: string, name: string): string;
