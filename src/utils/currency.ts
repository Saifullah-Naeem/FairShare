export function formatPkr(amountMinor: number): string {
  const safe = Math.trunc(amountMinor);
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  if (rem === 0) {
    return `${sign}PKR ${whole.toLocaleString('en-US')}`;
  }
  return `${sign}PKR ${whole.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}

export function formatPkrInput(amountMinor: number): string {
  const abs = Math.abs(Math.trunc(amountMinor));
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  if (rem === 0) return String(whole);
  return `${whole}.${String(rem).padStart(2, '0')}`;
}

export function parsePkrInputToMinor(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^pkr\s*/i, '')
    .replace(/^rs\.?\s*/i, '')
    .replace(/,/g, '');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const [wholePart, fracPart = ''] = cleaned.split('.');
  const whole = Number.parseInt(wholePart, 10);
  const frac = Number.parseInt(fracPart.padEnd(2, '0'), 10);
  const total = whole * 100 + frac;
  if (!Number.isSafeInteger(total) || total < 0) return null;
  return total;
}

export function computeEqualSplitPreview(
  totalMinor: number,
  memberIds: number[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (totalMinor <= 0 || memberIds.length === 0) return result;
  const sorted = [...new Set(memberIds)].sort((a, b) => a - b);
  const base = Math.floor(totalMinor / sorted.length);
  const rem = totalMinor % sorted.length;
  sorted.forEach((id, idx) => {
    result.set(id, base + (idx < rem ? 1 : 0));
  });
  return result;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-PK', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatSettlementStatus(status: string): string {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return 'Waiting for confirmation';
    case 'CONFIRMED':
      return 'Confirmed';
    case 'REJECTED':
      return 'Declined';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

export function formatAuditAction(actionType: string): string {
  switch (actionType) {
    case 'GROUP_CREATED':
      return 'Group created';
    case 'GROUP_STYLE_UPDATED':
      return 'Group badge updated';
    case 'MEMBER_ADDED':
      return 'Member added';
    case 'FRIEND_INVITED':
      return 'Friend invited';
    case 'INVITE_CODE_REISSUED':
      return 'New invite code created';
    case 'INVITE_CLAIMED':
      return 'Invite code claimed';
    case 'EXPENSE_CREATED':
      return 'Bill added';
    case 'EXPENSE_VOIDED':
      return 'Bill removed';
    case 'SETTLEMENT_CREATED':
      return 'Payment recorded';
    case 'SETTLEMENT_CONFIRMED':
      return 'Payment confirmed';
    case 'SETTLEMENT_REJECTED':
      return 'Payment declined';
    case 'SETTLEMENT_CANCELLED':
      return 'Payment cancelled';
    case 'REMINDER_SETTINGS_UPDATED':
      return 'Reminder rules updated';
    case 'REMINDER_SNOOZED':
      return 'Reminders snoozed';
    case 'REMINDER_UNSNOOZED':
      return 'Reminders resumed';
    case 'REMINDER_BATCH_SENT':
      return 'Summary reminders sent';
    default:
      return actionType;
  }
}
