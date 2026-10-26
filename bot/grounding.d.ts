export function validateGroundedAnswer(answer: string, sourceData: string): {
  valid: boolean;
  unsupported: string[];
};

export function redactForAudit(text: string, propertySecretValues?: string[]): string;
