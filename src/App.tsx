import { useCallback, useState } from 'react';
import {
  addMemberByHandle,
  cancelSettlement,
  claimInviteCode,
  confirmSettlement,
  createExpense,
  createGroup,
  createSettlement,
  fetchGroupState,
  inviteUnregisteredFriend,
  loginAccount,
  registerAccount,
  reissueFriendInvite,
  rejectSettlement,
  sendBatchedReminders,
  setMemoryAuthToken,
  snoozeMyReminders,
  updateGroupAppearance,
  updateReminderSettings,
  voidExpense,
} from './api/client';
import { AuthGate, FirstGroupGate } from './components/AuthGate';
import { LayoutShell } from './components/LayoutShell';
import { AddExpenseScreen } from './components/screens/AddExpenseScreen';
import { BalancesPlanScreen } from './components/screens/BalancesPlanScreen';
import { HistoryAuditScreen } from './components/screens/HistoryAuditScreen';
import { OverviewScreen } from './components/screens/OverviewScreen';
import { SettlementsQueueScreen } from './components/screens/SettlementsQueueScreen';
import { ShadowInviteScreen } from './components/screens/ShadowInviteScreen';
import type {
  GroupSummary,
  LedgerState,
  ScreenId,
  TransferEdge,
  UserProfile,
} from './types/ledger';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [state, setState] = useState<LedgerState | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenId>('overview');
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [prefilledSettleEdge, setPrefilledSettleEdge] =
    useState<TransferEdge | null>(null);

  const showToast = useCallback(
    (kind: 'success' | 'error', message: string) => {
      setToast({ kind, message });
      window.setTimeout(() => {
        setToast((prev) => (prev?.message === message ? null : prev));
      }, 3600);
    },
    [],
  );

  const openGroup = useCallback(async (groupId: number) => {
    const groupState = await fetchGroupState(groupId);
    setActiveGroupId(groupId);
    setGroups(groupState.groups);
    setState(groupState);
  }, []);

  const handleSignOut = () => {
    setMemoryAuthToken(null);
    setUser(null);
    setGroups([]);
    setActiveGroupId(null);
    setState(null);
    setActiveScreen('overview');
    setPrefilledSettleEdge(null);
    setSelectedCategoryFilter(null);
  };

  if (!user) {
    return (
      <AuthGate
        busy={busy}
        onRegister={async (params) => {
          setBusy(true);
          try {
            const res = await registerAccount(params);
            setUser(res.user);
            setGroups(res.groups);
            if (res.activeGroupId) {
              await openGroup(res.activeGroupId);
            }
            showToast('success', `Welcome to FairShare, ${res.user.name}!`);
          } finally {
            setBusy(false);
          }
        }}
        onLogin={async (handle, password) => {
          setBusy(true);
          try {
            const res = await loginAccount(handle, password);
            setUser(res.user);
            setGroups(res.groups);
            if (res.activeGroupId) {
              await openGroup(res.activeGroupId);
            }
            showToast('success', `Signed in as ${res.user.name}.`);
          } finally {
            setBusy(false);
          }
        }}
        onClaimInvite={async (params) => {
          setBusy(true);
          try {
            const res = await claimInviteCode(params);
            setUser(res.user);
            setGroups(res.groups);
            setActiveGroupId(res.activeGroupId);
            setState(res.state);
            showToast('success', `Welcome ${res.user.name}! You joined the group.`);
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  if (!activeGroupId || !state) {
    return (
      <FirstGroupGate
        userName={user.name}
        busy={busy}
        onSignOut={handleSignOut}
        onCreateGroup={async ({ name, iconKey, accentTheme }) => {
          setBusy(true);
          try {
            const res = await createGroup({ name, iconKey, accentTheme });
            setActiveGroupId(res.groupId);
            setGroups(res.state.groups);
            setState(res.state);
            setActiveScreen('overview');
            showToast('success', `Group "${name}" created!`);
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  const pendingCount = state.settlements.filter(
    (s) => s.status === 'PENDING_CONFIRMATION',
  ).length;

  const currentMember = state.members.find(
    (m) => m.memberId === state.currentMemberId,
  );
  const canCustomizeGroup =
    currentMember?.role === 'HOST' || currentMember?.role === 'ADMIN';

  return (
    <LayoutShell
      activeScreen={activeScreen}
      onNavigate={(screen) => {
        if (screen !== 'history') {
          setSelectedCategoryFilter(null);
        }
        setActiveScreen(screen);
      }}
      user={user}
      groups={state.groups}
      activeGroupId={activeGroupId}
      canCustomizeGroup={canCustomizeGroup}
      pendingCount={pendingCount}
      busy={busy}
      onSignOut={handleSignOut}
      onSelectGroup={async (groupId) => {
        if (groupId === activeGroupId) return;
        setBusy(true);
        try {
          await openGroup(groupId);
          setPrefilledSettleEdge(null);
          setSelectedCategoryFilter(null);
        } catch (err) {
          showToast(
            'error',
            err instanceof Error ? err.message : 'Unable to switch group.',
          );
        } finally {
          setBusy(false);
        }
      }}
      onCreateGroup={async ({ name, iconKey, accentTheme }) => {
        setBusy(true);
        try {
          const res = await createGroup({ name, iconKey, accentTheme });
          setActiveGroupId(res.groupId);
          setGroups(res.state.groups);
          setState(res.state);
          setSelectedCategoryFilter(null);
          setActiveScreen('overview');
          showToast('success', `Switched to "${name}".`);
        } finally {
          setBusy(false);
        }
      }}
      onUpdateGroupStyle={async ({ iconKey, accentTheme }) => {
        setBusy(true);
        try {
          const res = await updateGroupAppearance(activeGroupId, {
            iconKey,
            accentTheme,
          });
          setState(res.state);
          setGroups(res.state.groups);
          showToast('success', 'Group badge updated.');
        } catch (err) {
          showToast(
            'error',
            err instanceof Error ? err.message : 'Unable to update badge.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {toast && (
        <div
          role="status"
          className={`fixed top-16 right-4 z-50 max-w-sm rounded-2xl border px-4 py-3 text-xs font-semibold shadow-lg backdrop-blur-md ${
            toast.kind === 'success'
              ? 'bg-[#EFFBF5]/95 border-emerald-300 text-emerald-900'
              : 'bg-rose-100/95 border-rose-300 text-rose-900'
          }`}
        >
          {toast.message}
        </div>
      )}

      {activeScreen === 'overview' && (
        <OverviewScreen
          state={state}
          onNavigate={setActiveScreen}
          onSelectCategory={(category) => {
            setSelectedCategoryFilter(category);
            setActiveScreen('history');
          }}
        />
      )}

      {activeScreen === 'balances' && (
        <BalancesPlanScreen
          state={state}
          busy={busy}
          onStartSettle={(edge) => {
            setPrefilledSettleEdge(edge);
            setActiveScreen('settlements');
          }}
          onUpdateReminderSettings={async (params) => {
            setBusy(true);
            try {
              const res = await updateReminderSettings(activeGroupId, params);
              setState(res.state);
              showToast('success', 'Reminder rules updated.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Failed to update rules.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onSnooze={async (hours) => {
            setBusy(true);
            try {
              const res = await snoozeMyReminders(activeGroupId, hours);
              setState(res.state);
              showToast(
                'success',
                hours === 0
                  ? 'Reminders resumed.'
                  : `Reminders snoozed for ${hours} hours.`,
              );
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Unable to snooze.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onSendReminders={async () => {
            setBusy(true);
            try {
              const res = await sendBatchedReminders(activeGroupId);
              setState(res.state);
              const sent = res.results.filter((r) => r.status === 'SENT').length;
              showToast('success', `Sent ${sent} summary reminder(s).`);
              return res.results;
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Unable to send reminders.',
              );
              return [];
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {activeScreen === 'add-expense' && (
        <AddExpenseScreen
          state={state}
          busy={busy}
          onSubmitExpense={async (params) => {
            setBusy(true);
            try {
              const res = await createExpense(activeGroupId, params);
              setState(res.state);
              showToast('success', 'Bill added!');
              setActiveScreen('overview');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {activeScreen === 'settlements' && (
        <SettlementsQueueScreen
          state={state}
          prefilledEdge={prefilledSettleEdge}
          onClearPrefill={() => setPrefilledSettleEdge(null)}
          busy={busy}
          onCreateSettlement={async (params) => {
            setBusy(true);
            try {
              const res = await createSettlement(activeGroupId, params);
              setState(res.state);
              showToast('success', 'Payment recorded! Waiting for confirmation.');
            } finally {
              setBusy(false);
            }
          }}
          onConfirmSettlement={async (id) => {
            setBusy(true);
            try {
              const res = await confirmSettlement(activeGroupId, id);
              setState(res.state);
              showToast('success', 'Payment confirmed.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Unable to confirm.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onRejectSettlement={async (id, reason) => {
            setBusy(true);
            try {
              const res = await rejectSettlement(activeGroupId, id, reason);
              setState(res.state);
              showToast('success', 'Payment declined.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Unable to decline.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onCancelSettlement={async (id) => {
            setBusy(true);
            try {
              const res = await cancelSettlement(activeGroupId, id);
              setState(res.state);
              showToast('success', 'Payment cancelled.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Unable to cancel.',
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {activeScreen === 'shadow' && (
        <ShadowInviteScreen
          state={state}
          busy={busy}
          onAddByHandle={async (handle) => {
            setBusy(true);
            try {
              const res = await addMemberByHandle(activeGroupId, handle);
              setState(res.state);
              showToast('success', 'Roommate added to group.');
            } finally {
              setBusy(false);
            }
          }}
          onInviteUnregistered={async (name) => {
            setBusy(true);
            try {
              const res = await inviteUnregisteredFriend(activeGroupId, name);
              setState(res.state);
              showToast('success', `Invite code created for ${name}.`);
              return { inviteCode: res.inviteCode };
            } finally {
              setBusy(false);
            }
          }}
          onReissueInvite={async (memberId) => {
            setBusy(true);
            try {
              const res = await reissueFriendInvite(activeGroupId, memberId);
              setState(res.state);
              showToast('success', 'New invite code ready to copy.');
              return { inviteCode: res.inviteCode };
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {activeScreen === 'history' && (
        <HistoryAuditScreen
          state={state}
          categoryFilter={selectedCategoryFilter}
          onClearCategoryFilter={() => setSelectedCategoryFilter(null)}
          busy={busy}
          onVoidExpense={async (expenseId, reason) => {
            setBusy(true);
            try {
              const res = await voidExpense(activeGroupId, expenseId, reason);
              setState(res.state);
              showToast('success', 'Bill marked as removed.');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </LayoutShell>
  );
}
