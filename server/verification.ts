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
  getActiveDevTokens(): VerificationTokenRecord[];
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
    console.log(
      `[DEV MOCK VERIFICATION] ${record.purpose} -> ${record.recipientLabel} | Code/Token: ${record.token} | Expires: ${record.expiresAt} | ${record.detail}`,
    );
    return record;
  }

  public sendBatchSummary(params: {
    recipientLabel: string;
    summaryText: string;
  }): { delivered: boolean; channel: string; note: string } {
    console.log(
      `[DEV MOCK REMINDER] To: ${params.recipientLabel} | Summary: ${params.summaryText}`,
    );
    return {
      delivered: true,
      channel: 'dev_mock_console',
      note: 'Logged batched summary reminder to server console (no paid SMS/email sent).',
    };
  }

  public getActiveDevTokens(): VerificationTokenRecord[] {
    this.pruneExpired();
    return Array.from(this.activeTokens.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
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
      'Production SMS/Email verification gateway is intentionally stubbed in this portfolio demo. Set FAIRSHARE_VERIFICATION_MODE=dev_mock.',
    );
  }

  public sendBatchSummary(): { delivered: boolean; channel: string; note: string } {
    throw new Error(
      'Production SMS/Email gateway is not configured in this concept demo.',
    );
  }

  public getActiveDevTokens(): VerificationTokenRecord[] {
    return [];
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
