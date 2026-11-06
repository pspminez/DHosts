export const ADMIN_PASSWORD_MIN_LENGTH: number;
export const ADMIN_PASSWORD_MAX_LENGTH: number;

export interface StoredAdminPassword {
  version: 1;
  iterations: number;
  salt: string;
  hash: string;
}

export interface AdminPasswordEnv {
  ADMIN_PASSWORD?: string;
  PROPERTIES: KVNamespace;
}

export function adminPasswordProblem(password: unknown): string;
export function loadStoredAdminPassword(kv: KVNamespace): Promise<StoredAdminPassword | null>;
export function adminPasswordConfigured(env: AdminPasswordEnv): Promise<boolean>;
export function verifyAdminPassword(env: AdminPasswordEnv, candidate: unknown): Promise<boolean>;
export function saveAdminPassword(kv: KVNamespace, password: string): Promise<void>;
export function revokeAllAdminSessions(kv: KVNamespace): Promise<void>;
