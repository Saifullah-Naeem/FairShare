import crypto from 'node:crypto';

export type VerificationMode = 'dev_mock' | 'production_stub';

export interface VerificationTokenRecord {
  id: string;
  purpose: 'SHADOW_CLAIM' | 'REMINDER_BATCH' | 'ACCOUNT_LOGIN_OTP';
  recipientLabel: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  detail: string;
}

export interface VerificationProvider {
  readonly mode: VerificationMode;
  issueToken(params: {
    purpose: VerificationTokenRecord['purpose'];
    recipientLabel: string;
    detail: string;
    ttlMinutes?: number;
    fixedToken?: string;
  }): VerificationTokenRecord;
  sendBatchSummary(params: {
    recipientLabel: string;
    summaryText: string;
  }): { delivered: boolean; channel: string; note: string };
  consumeToken(token: string): void;
  clear(): void;
}

export class DevMockVerificationProvider implements VerificationProvider {
  public readonly mode: VerificationMode = 'dev_mock';
  private activeTokens: Map<string, VerificationTokenRecord> = new Map();

  public issueToken(params: {
    purpose: VerificationTokenRecord['purpose'];
    recipientLabel: string;
    detail: string;
    ttlMinutes?: number;
    fixedToken?: string;
  }): VerificationTokenRecord {
    this.pruneExpired();
    const ttlMinutes = params.ttlMinutes ?? 60 * 24;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const token =
      params.fixedToken ??
      `FS-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    const record: VerificationTokenRecord = {
      id: crypto.randomUUID(),
      purpose: params.purpose,
      recipientLabel: params.recipientLabel,
      token,
      expiresAt,
      createdAt: now.toISOString(),
      detail: params.detail,
    };

    this.activeTokens.set(token, record);
    return record;
  }

  public sendBatchSummary(params: {
    recipientLabel: string;
    summaryText: string;
  }): { delivered: boolean; channel: string; note: string } {
    return {
      delivered: true,
      channel: 'in_app_summary',
      note: `Prepared summary reminder for ${params.recipientLabel} (${params.summaryText.length} chars).`,
    };
  }

  public consumeToken(token: string): void {
    this.activeTokens.delete(token);
  }

  public clear(): void {
    this.activeTokens.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.activeTokens.entries()) {
      if (new Date(item.expiresAt).getTime() <= now) {
        this.activeTokens.delete(key);
      }
    }
  }
}

export class ProductionStubVerificationProvider implements VerificationProvider {
  public readonly mode: VerificationMode = 'production_stub';

  public issueToken(): VerificationTokenRecord {
    throw new Error(
      'External SMS/Email delivery is not configured. Use FAIRSHARE_VERIFICATION_MODE=dev_mock for local invite codes.',
    );
  }

  public sendBatchSummary(): { delivered: boolean; channel: string; note: string } {
    throw new Error(
      'External SMS/Email reminder delivery is not configured.',
    );
  }

  public consumeToken(): void {
    // No-op in production stub
  }

  public clear(): void {
    // No-op in production stub
  }
}

export function createVerificationProvider(modeRaw?: string): VerificationProvider {
  if (modeRaw === 'production_stub') {
    return new ProductionStubVerificationProvider();
  }
  return new DevMockVerificationProvider();
}
