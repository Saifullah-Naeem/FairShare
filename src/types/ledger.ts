export type Role = 'HOST' | 'ADMIN' | 'MEMBER';
export type SplitMode = 'EQUAL' | 'CUSTOM';
export type ExpenseStatus = 'ACTIVE' | 'VOIDED';
export type SettlementStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED';

export type ScreenId =
  | 'overview'
  | 'balances'
  | 'add-expense'
  | 'settlements'
  | 'shadow'
  | 'history';

export interface GroupInfo {
  id: number;
  name: string;
  currencyCode: string;
  quietHoursStart: number;
  quietHoursEnd: number;
  reminderCooldownHours: number;
  createdAt: string;
}

export interface GroupMember {
  memberId: number;
  userId: number;
  name: string;
  handle: string | null;
  role: Role;
  isShadow: boolean;
  claimedAt: string | null;
  claimTokenExpiresAt: string | null;
  snoozedUntil: string | null;
  lastRemindedAt: string | null;
}

export interface ExpenseSplitItem {
  memberId: number;
  memberName: string;
  amountMinor: number;
}

export interface ExpenseItem {
  id: number;
  groupId: number;
  paidByMemberId: number;
  paidByName: string;
  title: string;
  category: string;
  totalMinor: number;
  splitMode: SplitMode;
  status: ExpenseStatus;
  voidReason: string | null;
  voidedByMemberId: number | null;
  voidedByName: string | null;
  receiptPath: string | null;
  createdAt: string;
  splits: ExpenseSplitItem[];
}

export interface SettlementItem {
  id: number;
  groupId: number;
  fromMemberId: number;
  fromName: string;
  toMemberId: number;
  toName: string;
  amountMinor: number;
  status: SettlementStatus;
  note: string | null;
  receiptPath: string | null;
  rejectionReason: string | null;
  actedByMemberId: number | null;
  actedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NetBalanceItem {
  memberId: number;
  name: string;
  handle: string | null;
  role: Role;
  isShadow: boolean;
  paidMinor: number;
  owedMinor: number;
  settledOutMinor: number;
  settledInMinor: number;
  netMinor: number;
}

export interface TransferEdge {
  fromMemberId: number;
  fromName: string;
  toMemberId: number;
  toName: string;
  amountMinor: number;
}

export interface GroupBalanceSummary {
  totalActiveSpendMinor: number;
  totalVoidedSpendMinor: number;
  totalConfirmedSettledMinor: number;
  pendingSettlementsMinor: number;
  zeroSumCheckMinor: number;
  netBalances: NetBalanceItem[];
  rawPairBalances: TransferEdge[];
  simplifiedPlan: TransferEdge[];
}

export interface ReminderStatusItem {
  memberId: number;
  name: string;
  isShadow: boolean;
  owedMinor: number;
  eligible: boolean;
  inQuietHours: boolean;
  isSnoozed: boolean;
  inCooldown: boolean;
  reason: string;
  nextAllowedAt: string | null;
}

export interface AuditLogItem {
  id: number;
  groupId: number;
  actorMemberId: number | null;
  actorName: string;
  actionType: string;
  entityType: string;
  entityId: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface VerificationTokenItem {
  id: string;
  purpose: 'SHADOW_CLAIM' | 'REMINDER_BATCH' | 'ACCOUNT_LOGIN_OTP';
  recipientLabel: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  detail: string;
}

export interface LedgerState {
  demoEnvironment: boolean;
  verificationMode: 'dev_mock' | 'production_stub';
  devTokens: VerificationTokenItem[];
  currentMemberId: number | null;
  group: GroupInfo;
  members: GroupMember[];
  expenses: ExpenseItem[];
  settlements: SettlementItem[];
  balances: GroupBalanceSummary;
  reminderStatuses: ReminderStatusItem[];
  auditLogs: AuditLogItem[];
}
