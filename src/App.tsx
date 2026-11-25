import { useCallback, useEffect, useState } from 'react';
import {
  cancelSettlement,
  claimShadowMember,
  confirmSettlement,
  createExpense,
  createSettlement,
  fetchLedgerState,
  inviteShadowMember,
  loginWithHandle,
  rejectSettlement,
  resetDemoDatabase,
  sendBatchedReminders,
  snoozeMyReminders,
  switchDemoPerspective,
  updateReminderSettings,
  voidExpense,
} from './api/client';
import { LayoutShell } from './components/LayoutShell';
import { AddExpenseScreen } from './components/screens/AddExpenseScreen';
import { BalancesPlanScreen } from './components/screens/BalancesPlanScreen';
import { HistoryAuditScreen } from './components/screens/HistoryAuditScreen';
import { OverviewScreen } from './components/screens/OverviewScreen';
import { SettlementsQueueScreen } from './components/screens/SettlementsQueueScreen';
import { ShadowInviteScreen } from './components/screens/ShadowInviteScreen';
import type { LedgerState, ScreenId, TransferEdge } from './types/ledger';

export default function App() {
  const [state, setState] = useState<LedgerState | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenId>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [prefilledSettleEdge, setPrefilledSettleEdge] =
    useState<TransferEdge | null>(null);
  const [prefilledClaimToken, setPrefilledClaimToken] = useState<string>('');

  const showToast = useCallback(
    (kind: 'success' | 'error', message: string) => {
      setToast({ kind, message });
      window.setTimeout(() => {
        setToast((prev) => (prev?.message === message ? null : prev));
      }, 4000);
    },
    [],
  );

  const loadInitialState = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let data = await fetchLedgerState();
      if (!data.currentMemberId) {
        const defaultHost =
          data.members.find((m) => m.role === 'HOST' && !m.isShadow) ??
          data.members.find((m) => !m.isShadow);
        if (defaultHost) {
          await switchDemoPerspective(defaultHost.memberId);
          data = await fetchLedgerState();
        }
      }
      setState(data);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load FairShare Ledger.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitialState();
  }, [loadInitialState]);

  const handleSwitchMember = async (memberId: number) => {
    setBusy(true);
    try {
      const res = await switchDemoPerspective(memberId);
      const updated = await fetchLedgerState();
      setState(updated);
      showToast('success', `Switched perspective to ${res.member.name} (${res.member.role}).`);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to switch member.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleResetDemo = async () => {
    setBusy(true);
    try {
      const res = await resetDemoDatabase();
      setState(res.state);
      setPrefilledClaimToken('');
      setPrefilledSettleEdge(null);
      showToast('success', 'Demo ledger wiped and re-seeded with fresh PKR data.');
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Demo reset failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading && !state) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-200 p-6 max-w-5xl mx-auto space-y-5">
        <div className="h-10 w-56 rounded-xl bg-slate-800/80" />
        <div className="h-44 rounded-2xl bg-slate-900 border border-slate-800" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="h-64 rounded-2xl bg-slate-900 border border-slate-800" />
          <div className="h-64 rounded-2xl bg-slate-900 border border-slate-800" />
        </div>
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl bg-[#131C2E] border border-slate-800 p-6 space-y-4 text-center">
          <h1 className="font-display text-xl font-bold">
            Unable to Connect to FairShare Ledger
          </h1>
          <p className="text-sm text-slate-400">
            {loadError ?? 'The SQLite backend did not respond.'}
          </p>
          <button
            type="button"
            onClick={() => void loadInitialState()}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const currentMember =
    state.members.find((m) => m.memberId === state.currentMemberId) ?? null;
  const pendingCount = state.settlements.filter(
    (s) => s.status === 'PENDING_CONFIRMATION',
  ).length;

  return (
    <LayoutShell
      activeScreen={activeScreen}
      onNavigate={setActiveScreen}
      groupName={state.group.name}
      members={state.members}
      currentMember={currentMember}
      pendingCount={pendingCount}
      devTokens={state.devTokens}
      verificationMode={state.verificationMode}
      onSwitchMember={handleSwitchMember}
      onResetDemo={handleResetDemo}
      onPrefillClaimToken={(tok) => setPrefilledClaimToken(tok)}
      busy={busy}
    >
      {toast && (
        <div
          role="status"
          className={`fixed top-16 right-4 z-50 max-w-sm rounded-xl border px-4 py-3 text-xs font-medium shadow-xl backdrop-blur-md transition-opacity ${
            toast.kind === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.message}
        </div>
      )}

      {activeScreen === 'overview' && (
        <OverviewScreen
          state={state}
          onNavigate={setActiveScreen}
          onSwitchMember={handleSwitchMember}
          onResetDemo={handleResetDemo}
          busy={busy}
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
              const res = await updateReminderSettings(params);
              setState(res.state);
              showToast('success', 'Quiet hours and cooldown updated.');
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
              const res = await snoozeMyReminders(hours);
              setState(res.state);
              showToast(
                'success',
                hours === 0
                  ? 'Reminder snooze cleared.'
                  : `Your reminders are snoozed for ${hours} hours.`,
              );
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Failed to snooze.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onSendReminders={async (testHour) => {
            setBusy(true);
            try {
              const res = await sendBatchedReminders(testHour);
              setState(res.state);
              const sent = res.results.filter((r) => r.status === 'SENT').length;
              const suppressed = res.results.filter(
                (r) => r.status === 'SUPPRESSED',
              ).length;
              showToast(
                'success',
                `Batch processed: ${sent} sent, ${suppressed} suppressed by non-spam rules.`,
              );
              return res.results;
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Reminder dispatch failed.',
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
              const res = await createExpense(params);
              setState(res.state);
              showToast('success', 'Expense recorded with exact paisa splits.');
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
              const res = await createSettlement(params);
              setState(res.state);
              showToast(
                'success',
                'Settlement submitted as PENDING_CONFIRMATION.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onConfirmSettlement={async (id) => {
            setBusy(true);
            try {
              const res = await confirmSettlement(id);
              setState(res.state);
              showToast('success', 'Settlement confirmed and balances updated.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Confirm failed.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onRejectSettlement={async (id, reason) => {
            setBusy(true);
            try {
              const res = await rejectSettlement(id, reason);
              setState(res.state);
              showToast('success', 'Settlement rejected with reason recorded.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Reject failed.',
              );
            } finally {
              setBusy(false);
            }
          }}
          onCancelSettlement={async (id) => {
            setBusy(true);
            try {
              const res = await cancelSettlement(id);
              setState(res.state);
              showToast('success', 'Pending settlement cancelled.');
            } catch (err) {
              showToast(
                'error',
                err instanceof Error ? err.message : 'Cancel failed.',
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
          prefilledToken={prefilledClaimToken}
          busy={busy}
          onInviteShadow={async (name) => {
            setBusy(true);
            try {
              const res = await inviteShadowMember(name);
              setState(res.state);
              showToast('success', `Added shadow member ${name}.`);
              return { claimToken: res.claimToken };
            } finally {
              setBusy(false);
            }
          }}
          onClaimShadow={async (params) => {
            setBusy(true);
            try {
              const res = await claimShadowMember(params);
              setState(res.state);
              setPrefilledClaimToken('');
              showToast(
                'success',
                `Welcome ${res.claimedMember.name}! Account claimed & locked.`,
              );
            } finally {
              setBusy(false);
            }
          }}
          onLogin={async (handle, password) => {
            setBusy(true);
            try {
              const res = await loginWithHandle(handle, password);
              const updated = await fetchLedgerState();
              setState(updated);
              showToast('success', `Signed in as ${res.member.name}.`);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {activeScreen === 'history' && (
        <HistoryAuditScreen
          state={state}
          busy={busy}
          onVoidExpense={async (expenseId, reason) => {
            setBusy(true);
            try {
              const res = await voidExpense(expenseId, reason);
              setState(res.state);
              showToast(
                'success',
                'Expense marked VOIDED and preserved in audit history.',
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </LayoutShell>
  );
}
