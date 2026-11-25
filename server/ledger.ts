export type Role = 'HOST' | 'ADMIN' | 'MEMBER';
export type SplitMode = 'EQUAL' | 'CUSTOM';
export type ExpenseStatus = 'ACTIVE' | 'VOIDED';
export type SettlementStatus =
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED';

export interface MemberRecord {
  memberId: number;
  userId: number;
  name: string;
  handle: string | null;
  role: Role;
  isShadow: boolean;
  claimedAt: string | null;
  snoozedUntil: string | null;
  lastRemindedAt: string | null;
}

export interface ExpenseRecord {
  id: number;
  groupId: number;
  paidByMemberId: number;
  title: string;
  category: string;
  totalMinor: number;
  splitMode: SplitMode;
  status: ExpenseStatus;
  voidReason: string | null;
  voidedByMemberId: number | null;
  receiptPath: string | null;
  createdAt: string;
}

export interface SplitRecord {
  expenseId: number;
  memberId: number;
  amountMinor: number;
}

export interface SettlementRecord {
  id: number;
  groupId: number;
  fromMemberId: number;
  toMemberId: number;
  amountMinor: number;
  status: SettlementStatus;
  note: string | null;
  receiptPath: string | null;
  rejectionReason: string | null;
  actedByMemberId: number | null;
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

export function parsePkrToMinor(raw: string | number): number {
  const cleaned = String(raw)
    .trim()
    .replace(/^pkr\s*/i, '')
    .replace(/^rs\.?\s*/i, '')
    .replace(/,/g, '');

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error('Enter a valid positive PKR amount (e.g. 1250 or 1250.50).');
  }

  const [wholePart, fracPart = ''] = cleaned.split('.');
  const whole = Number.parseInt(wholePart, 10);
  const frac = Number.parseInt(fracPart.padEnd(2, '0'), 10);
  const totalMinor = whole * 100 + frac;

  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new Error('Amount must be greater than PKR 0.');
  }

  return totalMinor;
}

export function formatMinorToPkr(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error('Currency value must be an integer.');
  }
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  const formattedWhole = whole.toLocaleString('en-US');
  if (rem === 0) {
    return `${sign}PKR ${formattedWhole}`;
  }
  return `${sign}PKR ${formattedWhole}.${String(rem).padStart(2, '0')}`;
}

export function computeEqualSplits(
  totalMinor: number,
  memberIds: number[],
): Array<{ memberId: number; amountMinor: number }> {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new Error('Total amount must be greater than PKR 0.');
  }
  const uniqueSorted = [...new Set(memberIds)].sort((a, b) => a - b);
  if (uniqueSorted.length === 0) {
    throw new Error('Select at least one person to split this bill.');
  }

  const count = uniqueSorted.length;
  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor % count;

  return uniqueSorted.map((memberId, index) => ({
    memberId,
    amountMinor: base + (index < remainder ? 1 : 0),
  }));
}

export function validateCustomSplits(
  totalMinor: number,
  splits: Array<{ memberId: number; amountMinor: number }>,
): Array<{ memberId: number; amountMinor: number }> {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new Error('Total amount must be greater than PKR 0.');
  }
  if (splits.length === 0) {
    throw new Error('Assign amounts to at least one person.');
  }

  const seen = new Set<number>();
  let runningSum = 0;

  for (const s of splits) {
    if (!Number.isInteger(s.memberId) || s.memberId <= 0) {
      throw new Error('Invalid member in split list.');
    }
    if (seen.has(s.memberId)) {
      throw new Error('Each person can only appear once in a split.');
    }
    if (!Number.isInteger(s.amountMinor) || s.amountMinor < 0) {
      throw new Error('Each share must be a valid PKR amount.');
    }
    seen.add(s.memberId);
    runningSum += s.amountMinor;
  }

  if (runningSum !== totalMinor) {
    const diff = totalMinor - runningSum;
    throw new Error(
      `Split total (${formatMinorToPkr(runningSum)}) must match ${formatMinorToPkr(totalMinor)}. Difference: ${formatMinorToPkr(diff)}.`,
    );
  }

  return splits.filter((s) => s.amountMinor > 0);
}

export function computeGroupBalances(
  members: MemberRecord[],
  expenses: ExpenseRecord[],
  splits: SplitRecord[],
  settlements: SettlementRecord[],
): GroupBalanceSummary {
  const memberMap = new Map<number, MemberRecord>();
  const ledgerMap = new Map<number, NetBalanceItem>();

  for (const m of members) {
    memberMap.set(m.memberId, m);
    ledgerMap.set(m.memberId, {
      memberId: m.memberId,
      name: m.name,
      handle: m.handle,
      role: m.role,
      isShadow: m.isShadow,
      paidMinor: 0,
      owedMinor: 0,
      settledOutMinor: 0,
      settledInMinor: 0,
      netMinor: 0,
    });
  }

  const splitsByExpense = new Map<number, SplitRecord[]>();
  for (const s of splits) {
    const arr = splitsByExpense.get(s.expenseId) ?? [];
    arr.push(s);
    splitsByExpense.set(s.expenseId, arr);
  }

  const pairDebt = new Map<string, number>();
  const addPairDebt = (fromId: number, toId: number, delta: number) => {
    if (fromId === toId || delta === 0) return;
    const key = `${fromId}->${toId}`;
    pairDebt.set(key, (pairDebt.get(key) ?? 0) + delta);
  };

  let totalActiveSpendMinor = 0;
  let totalVoidedSpendMinor = 0;

  for (const exp of expenses) {
    if (exp.status === 'VOIDED') {
      totalVoidedSpendMinor += exp.totalMinor;
      continue;
    }
    totalActiveSpendMinor += exp.totalMinor;

    const payerItem = ledgerMap.get(exp.paidByMemberId);
    if (payerItem) {
      payerItem.paidMinor += exp.totalMinor;
      payerItem.netMinor += exp.totalMinor;
    }

    const expSplits = splitsByExpense.get(exp.id) ?? [];
    for (const sp of expSplits) {
      const borrowerItem = ledgerMap.get(sp.memberId);
      if (borrowerItem) {
        borrowerItem.owedMinor += sp.amountMinor;
        borrowerItem.netMinor -= sp.amountMinor;
      }
      addPairDebt(sp.memberId, exp.paidByMemberId, sp.amountMinor);
    }
  }

  let totalConfirmedSettledMinor = 0;
  let pendingSettlementsMinor = 0;

  for (const st of settlements) {
    if (st.status === 'PENDING_CONFIRMATION') {
      pendingSettlementsMinor += st.amountMinor;
      continue;
    }
    if (st.status !== 'CONFIRMED') {
      continue;
    }

    totalConfirmedSettledMinor += st.amountMinor;

    const sender = ledgerMap.get(st.fromMemberId);
    const receiver = ledgerMap.get(st.toMemberId);
    if (sender) {
      sender.settledOutMinor += st.amountMinor;
      sender.netMinor += st.amountMinor;
    }
    if (receiver) {
      receiver.settledInMinor += st.amountMinor;
      receiver.netMinor -= st.amountMinor;
    }

    addPairDebt(st.fromMemberId, st.toMemberId, -st.amountMinor);
  }

  const rawPairBalances: TransferEdge[] = [];
  const memberIds = members.map((m) => m.memberId).sort((a, b) => a - b);
  for (let i = 0; i < memberIds.length; i += 1) {
    for (let j = i + 1; j < memberIds.length; j += 1) {
      const a = memberIds[i];
      const b = memberIds[j];
      const aToB = pairDebt.get(`${a}->${b}`) ?? 0;
      const bToA = pairDebt.get(`${b}->${a}`) ?? 0;
      const net = aToB - bToA;
      if (net > 0) {
        rawPairBalances.push({
          fromMemberId: a,
          fromName: memberMap.get(a)?.name ?? `Member ${a}`,
          toMemberId: b,
          toName: memberMap.get(b)?.name ?? `Member ${b}`,
          amountMinor: net,
        });
      } else if (net < 0) {
        rawPairBalances.push({
          fromMemberId: b,
          fromName: memberMap.get(b)?.name ?? `Member ${b}`,
          toMemberId: a,
          toName: memberMap.get(a)?.name ?? `Member ${a}`,
          amountMinor: Math.abs(net),
        });
      }
    }
  }
  rawPairBalances.sort((x, y) => y.amountMinor - x.amountMinor);

  const netBalances = Array.from(ledgerMap.values()).sort(
    (a, b) => b.netMinor - a.netMinor,
  );

  const creditors = netBalances
    .filter((m) => m.netMinor > 0)
    .map((m) => ({ memberId: m.memberId, name: m.name, remaining: m.netMinor }))
    .sort((a, b) => b.remaining - a.remaining || a.memberId - b.memberId);

  const debtors = netBalances
    .filter((m) => m.netMinor < 0)
    .map((m) => ({
      memberId: m.memberId,
      name: m.name,
      remaining: Math.abs(m.netMinor),
    }))
    .sort((a, b) => b.remaining - a.remaining || a.memberId - b.memberId);

  const simplifiedPlan: TransferEdge[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const cred = creditors[ci];
    const debt = debtors[di];
    const transfer = Math.min(cred.remaining, debt.remaining);

    if (transfer > 0) {
      simplifiedPlan.push({
        fromMemberId: debt.memberId,
        fromName: debt.name,
        toMemberId: cred.memberId,
        toName: cred.name,
        amountMinor: transfer,
      });
    }

    cred.remaining -= transfer;
    debt.remaining -= transfer;
    if (cred.remaining === 0) ci += 1;
    if (debt.remaining === 0) di += 1;
  }

  const zeroSumCheckMinor = netBalances.reduce((acc, m) => acc + m.netMinor, 0);

  return {
    totalActiveSpendMinor,
    totalVoidedSpendMinor,
    totalConfirmedSettledMinor,
    pendingSettlementsMinor,
    zeroSumCheckMinor,
    netBalances,
    rawPairBalances,
    simplifiedPlan,
  };
}

export interface ReminderEvaluation {
  eligible: boolean;
  inQuietHours: boolean;
  isSnoozed: boolean;
  inCooldown: boolean;
  reason: string;
  nextAllowedAt: string | null;
}

export function isHourInQuietWindow(
  hour: number,
  quietStart: number,
  quietEnd: number,
): boolean {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) {
    return hour >= quietStart && hour < quietEnd;
  }
  return hour >= quietStart || hour < quietEnd;
}

export function evaluateReminderEligibility(
  quietStart: number,
  quietEnd: number,
  cooldownHours: number,
  snoozedUntil: string | null,
  lastRemindedAt: string | null,
  now: Date = new Date(),
  overrideHour?: number,
): ReminderEvaluation {
  const currentHour =
    typeof overrideHour === 'number' && overrideHour >= 0 && overrideHour <= 23
      ? overrideHour
      : now.getHours();

  const inQuietHours = isHourInQuietWindow(currentHour, quietStart, quietEnd);
  const snoozeDate = snoozedUntil ? new Date(snoozedUntil) : null;
  const isSnoozed = Boolean(snoozeDate && snoozeDate.getTime() > now.getTime());

  let inCooldown = false;
  let cooldownUntil: Date | null = null;
  if (lastRemindedAt) {
    const last = new Date(lastRemindedAt);
    cooldownUntil = new Date(last.getTime() + cooldownHours * 3600 * 1000);
    if (cooldownUntil.getTime() > now.getTime()) {
      inCooldown = true;
    }
  }

  if (inQuietHours) {
    return {
      eligible: false,
      inQuietHours: true,
      isSnoozed,
      inCooldown,
      reason: `Paused during quiet hours (${String(quietStart).padStart(2, '0')}:00–${String(quietEnd).padStart(2, '0')}:00).`,
      nextAllowedAt: null,
    };
  }

  if (isSnoozed && snoozeDate) {
    return {
      eligible: false,
      inQuietHours: false,
      isSnoozed: true,
      inCooldown,
      reason: 'Snoozed by roommate.',
      nextAllowedAt: snoozeDate.toISOString(),
    };
  }

  if (inCooldown && cooldownUntil) {
    return {
      eligible: false,
      inQuietHours: false,
      isSnoozed: false,
      inCooldown: true,
      reason: `Wait ${cooldownHours}h between reminders.`,
      nextAllowedAt: cooldownUntil.toISOString(),
    };
  }

  return {
    eligible: true,
    inQuietHours: false,
    isSnoozed: false,
    inCooldown: false,
    reason: 'Ready for summary reminder.',
    nextAllowedAt: null,
  };
}
