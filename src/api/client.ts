import type { GroupSummary, LedgerState, UserProfile } from '../types/ledger';

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

export async function registerAccount(params: {
  name: string;
  handle: string;
  password: string;
  initialGroupName?: string;
  iconKey?: string;
  accentTheme?: string;
}): Promise<{
  token: string;
  user: UserProfile;
  groups: GroupSummary[];
  activeGroupId: number | null;
}> {
  const res = await apiRequest<{
    token: string;
    user: UserProfile;
    groups: GroupSummary[];
    activeGroupId: number | null;
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setMemoryAuthToken(res.token);
  return res;
}

export async function loginAccount(
  handle: string,
  password: string,
): Promise<{
  token: string;
  user: UserProfile;
  groups: GroupSummary[];
  activeGroupId: number | null;
}> {
  const res = await apiRequest<{
    token: string;
    user: UserProfile;
    groups: GroupSummary[];
    activeGroupId: number | null;
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ handle, password }),
  });
  setMemoryAuthToken(res.token);
  return res;
}

export async function claimInviteCode(params: {
  inviteCode: string;
  handle: string;
  password: string;
  displayName?: string;
}): Promise<{
  token: string;
  user: UserProfile;
  activeGroupId: number;
  groups: GroupSummary[];
  state: LedgerState;
}> {
  const res = await apiRequest<{
    token: string;
    user: UserProfile;
    activeGroupId: number;
    groups: GroupSummary[];
    state: LedgerState;
  }>('/api/shadow/claim', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  setMemoryAuthToken(res.token);
  return res;
}

export async function createGroup(params: {
  name: string;
  iconKey?: string;
  accentTheme?: string;
}): Promise<{ groupId: number; state: LedgerState }> {
  return apiRequest<{ groupId: number; state: LedgerState }>('/api/groups', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function updateGroupAppearance(
  groupId: number,
  params: { iconKey: string; accentTheme: string },
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/appearance`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
    },
  );
}

export async function fetchGroupState(groupId: number): Promise<LedgerState> {
  return apiRequest<LedgerState>(`/api/groups/${groupId}/state`);
}

export async function addMemberByHandle(
  groupId: number,
  handle: string,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(`/api/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ handle }),
  });
}

export async function createExpense(
  groupId: number,
  params: {
    title: string;
    category: string;
    amountPkr: string;
    paidByMemberId: number;
    splitMode: 'EQUAL' | 'CUSTOM';
    participantMemberIds?: number[];
    customSplits?: Array<{ memberId: number; amountMinor: number }>;
    receiptFile?: File | null;
  },
): Promise<{ expenseId: number; state: LedgerState }> {
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

  return apiRequest<{ expenseId: number; state: LedgerState }>(
    `/api/groups/${groupId}/expenses`,
    {
      method: 'POST',
      body: form,
    },
  );
}

export async function voidExpense(
  groupId: number,
  expenseId: number,
  reason: string,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/expenses/${expenseId}/void`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function createSettlement(
  groupId: number,
  params: {
    fromMemberId: number;
    toMemberId: number;
    amountPkr: string;
    note?: string;
    receiptFile?: File | null;
  },
): Promise<{ settlementId: number; state: LedgerState }> {
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
    `/api/groups/${groupId}/settlements`,
    {
      method: 'POST',
      body: form,
    },
  );
}

export async function confirmSettlement(
  groupId: number,
  settlementId: number,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/settlements/${settlementId}/confirm`,
    { method: 'POST' },
  );
}

export async function rejectSettlement(
  groupId: number,
  settlementId: number,
  reason: string,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/settlements/${settlementId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export async function cancelSettlement(
  groupId: number,
  settlementId: number,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/settlements/${settlementId}/cancel`,
    { method: 'POST' },
  );
}

export async function inviteUnregisteredFriend(
  groupId: number,
  name: string,
): Promise<{
  memberId: number;
  inviteCode: string;
  expiresAt: string;
  state: LedgerState;
}> {
  return apiRequest(`/api/groups/${groupId}/shadow/invite`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function reissueFriendInvite(
  groupId: number,
  memberId: number,
): Promise<{
  memberId: number;
  inviteCode: string;
  expiresAt: string;
  state: LedgerState;
}> {
  return apiRequest(`/api/groups/${groupId}/shadow/${memberId}/reissue`, {
    method: 'POST',
  });
}

export async function updateReminderSettings(
  groupId: number,
  params: {
    quietHoursStart: number;
    quietHoursEnd: number;
    reminderCooldownHours: number;
  },
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/reminders/settings`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
    },
  );
}

export async function snoozeMyReminders(
  groupId: number,
  hours: number,
): Promise<{ state: LedgerState }> {
  return apiRequest<{ state: LedgerState }>(
    `/api/groups/${groupId}/reminders/snooze`,
    {
      method: 'POST',
      body: JSON.stringify({ hours }),
    },
  );
}

export async function sendBatchedReminders(groupId: number): Promise<{
  results: Array<{
    memberId: number;
    name: string;
    status: 'SENT' | 'SUPPRESSED';
    reason: string;
    summaryText?: string;
  }>;
  state: LedgerState;
}> {
  return apiRequest(`/api/groups/${groupId}/reminders/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
