export function makeGmailRawMessage(options: {
  from: string;
  to: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}): string;
export function encryptRefreshToken(refreshToken: string, encodedKey: string): Promise<string>;
export function decryptRefreshToken(encrypted: string, encodedKey: string): Promise<string>;
export function makeUnsubscribeToken(): string;
export function hashOutreachValue(value: string): Promise<string>;
export function hashUnsubscribeToken(token: string): Promise<string>;
