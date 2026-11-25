import type { GroupMember, LedgerState } from '../types/ledger';

let memoryToken: string | null = null;

export function setMemoryAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getMemoryAuthToken(): string | null {
  return memoryToken;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

export async function fetchLedgerState(): Promise<LedgerState> {
  return apiRequest<LedgerState>('/api/state');
}

export async function switchDemoPerspective(
  memberId: number,
): Promise<{ token: string; member: GroupMember }> {
  const res = await apiRequest<{ token: string; member: GroupMember }>(
    '/api/auth/demo-switch',
    {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    },
  );
  setMemoryAuthToken(res.token);
  return res;
}

export async function loginWithHandle(
  handle: string,
  password: string,
): Promise<{ token: string; member: GroupMember }> {
  const res = await apiRequest<{ token: string; member: GroupMember }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ handle, password }),
    },
  );
  setMemoryAuthToken(res.token);
  return res;
}

export async function createExpense(params: {
  title: string;
  category: string;
  amountPkr: string;
  paidByMemberId: number;
  splitMode: 'EQUAL' | 'CUSTOM';
  participantMemberIds?: number[];
  customSplits?: Array<{ memberId: number; amountMinor: number }>;
  receiptFile?: File | null;
}): Promise<{ expenseId: number; state: LedgerState }> {
  const form = new FormData();
  form.append('title', params.title);
  form.append('category', params.category);
  form.append('amountPkr', params.amountPkr);
  form.append('paidByMemberId', String(params.paidByMemberId));
  form.append('splitMode', params.splitMode);
  if (params.participantMemberIds) {
    form.append(
      'participantMemberIds',
      JSON.stringify(params.participantMemberIds),
    );
  }
  if (params.customSplits) {
    form.append('customSplits', JSON.stringify(params.customSplits));
  }
  if (params.receiptFile) {
    form.append('receipt', params.receiptFile);
  }

  return apiRequest<{ expenseId: number; state: LedgerState }>('/api/expenses', {
    method: 'POST',
    body: form,
  });
}

export async function voidExpense(
  expenseId: number,
  reason: string,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(`/api/expenses/${expenseId}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function createSettlement(params: {
  fromMemberId: number;
  toMemberId: number;
  amountPkr: string;
  note?: string;
  receiptFile?: File | null;
}): Promise<{ settlementId: number; state: LedgerState }> {
  const form = new FormData();
  form.append('fromMemberId', String(params.fromMemberId));
  form.append('toMemberId', String(params.toMemberId));
  form.append('amountPkr', params.amountPkr);
  if (params.note) {
    form.append('note', params.note);
  }
  if (params.receiptFile) {
    form.append('receipt', params.receiptFile);
  }

  return apiRequest<{ settlementId: number; state: LedgerState }>(
    '/api/settlements',
    {
      method: 'POST',
      body: form,
    },
  );
}

export async function confirmSettlement(
  settlementId: number,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/settlements/${settlementId}/confirm`,
    { method: 'POST' },
  );
}

export async function rejectSettlement(
  settlementId: number,
  reason: string,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/settlements/${settlementId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function cancelSettlement(
  settlementId: number,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/settlements/${settlementId}/cancel`,
    { method: 'POST' },
  );
}

export async function inviteShadowMember(name: string): Promise<{
  memberId: number;
  claimToken: string | null;
  expiresAt: string;
  state: LedgerState;
}> {
  return apiRequest('/api/shadow/invite', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function claimShadowMember(params: {
  claimToken: string;
  handle: string;
  password: string;
  displayName?: string;
}): Promise<{
  token: string;
  claimedMember: GroupMember;
  state: LedgerState;
}> {
  const res = await apiRequest<{
    token: string;
    claimedMember: GroupMember;
    state: LedgerState;
  }>('/api/shadow/claim', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setMemoryAuthToken(res.token);
  return res;
}

export async function updateReminderSettings(params: {
  quietHoursStart: number;
  quietHoursEnd: number;
  reminderCooldownHours: number;
}): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>('/api/reminders/settings', {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
}

export async function snoozeMyReminders(
  hours: number,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>('/api/reminders/snooze', {
    method: 'POST',
    body: JSON.stringify({ hours }),
  });
}

export async function sendBatchedReminders(testHour?: number): Promise<{
  results: Array<{
    memberId: number;
    name: string;
    status: 'SENT' | 'SUPPRESSED';
    reason: string;
    summaryText?: string;
  }>;
  state: LedgerState;
}> {
  return apiRequest('/api/reminders/send', {
    method: 'POST',
    body: JSON.stringify(typeof testHour === 'number' ? { testHour } : {}),
  });
}

export async function resetDemoDatabase(): Promise<{
  token: string;
  member: GroupMember;
  state: LedgerState;
}> {
  const res = await apiRequest<{
    token: string;
    member: GroupMember;
    state: LedgerState;
  }>('/api/demo/reset', { method: 'POST' });
  setMemoryAuthToken(res.token);
  return res;
}
