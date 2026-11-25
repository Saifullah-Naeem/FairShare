import React, { useState } from 'react';
import {
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import type { LedgerState, TransferEdge } from '../../types/ledger';
import { formatPkr, formatTimestamp } from '../../utils/currency';

interface BalancesPlanScreenProps {
  state: LedgerState;
  onStartSettle: (edge: TransferEdge) => void;
  onUpdateReminderSettings: (params: {
    quietHoursStart: number;
    quietHoursEnd: number;
    reminderCooldownHours: number;
  }) => Promise<void>;
  onSnooze: (hours: number) => Promise<void>;
  onSendReminders: () => Promise<
    Array<{
      memberId: number;
      name: string;
      status: 'SENT' | 'SUPPRESSED';
      reason: string;
      summaryText?: string;
    }>
  >;
  busy: boolean;
}

export const BalancesPlanScreen: React.FC<BalancesPlanScreenProps> = ({
  state,
  onStartSettle,
  onUpdateReminderSettings,
  onSnooze,
  onSendReminders,
  busy,
}) => {
  const [planView, setPlanView] = useState<'simplified' | 'raw'>('simplified');
  const [quietStart, setQuietStart] = useState(state.group.quietHoursStart);
  const [quietEnd, setQuietEnd] = useState(state.group.quietHoursEnd);
  const [cooldownHours, setCooldownHours] = useState(
    state.group.reminderCooldownHours,
  );
  const [showReminderSettings, setShowReminderSettings] = useState(false);
  const [dispatchLog, setDispatchLog] = useState<
    Array<{
      memberId: number;
      name: string;
      status: 'SENT' | 'SUPPRESSED';
      reason: string;
      summaryText?: string;
    }>
  >([]);

  const currentMember = state.members.find(
    (m) => m.memberId === state.currentMemberId,
  );
  const isHostOrAdmin =
    currentMember?.role === 'HOST' || currentMember?.role === 'ADMIN';

  const activeTransfers =
    planView === 'simplified'
      ? state.balances.simplifiedPlan
      : state.balances.rawPairBalances;

  return (
    <div className="space-y-4">
      {/* Settlement Plan vs By Person (Mint Card) */}
      <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {planView === 'simplified'
                ? 'Best Settlement Plan'
                : 'Direct Balances By Person'}
            </h2>
            <p className="text-xs text-slate-600">
              {planView === 'simplified'
                ? `Settle the whole group in just ${state.balances.simplifiedPlan.length} payments.`
                : 'Shows every direct person-to-person balance.'}
            </p>
          </div>

          <div className="inline-flex items-center p-1 rounded-2xl bg-white/80 border border-emerald-200 self-start">
            <button
              type="button"
              onClick={() => setPlanView('simplified')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                planView === 'simplified'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Best Plan ({state.balances.simplifiedPlan.length})
            </button>
            <button
              type="button"
              onClick={() => setPlanView('raw')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                planView === 'raw'
                  ? 'bg-violet-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By Person ({state.balances.rawPairBalances.length})
            </button>
          </div>
        </div>

        {activeTransfers.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-600 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-7 h-7 text-emerald-700" />
            <span>Everyone is completely settled up.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeTransfers.map((edge) => (
              <div
                key={`${edge.fromMemberId}-${edge.toMemberId}`}
                className="rounded-2xl bg-gradient-to-r from-white/85 to-[#F4F0FD]/90 border border-emerald-200/70 p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <span className="truncate">{edge.fromName}</span>
                    <ArrowRight className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="truncate">{edge.toName}</span>
                  </div>
                  <div className="mt-1 font-mono tabular-nums text-base font-bold text-emerald-800">
                    {formatPkr(edge.amountMinor)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onStartSettle(edge)}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-700 to-violet-700 hover:from-emerald-600 hover:to-violet-600 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  Pay Now
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Everyone's Net Position (Lilac Card) */}
      <section className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-3 shadow-xs">
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">
            Everyone&apos;s Balance
          </h3>
          <p className="text-xs text-slate-600">
            Total paid minus their share of group bills and confirmed payments.
          </p>
        </div>

        <div data-no-swipe="true" className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-left border-collapse min-w-[480px]">
            <thead>
              <tr className="border-b border-violet-200/70 text-xs text-slate-600 font-semibold">
                <th className="py-2.5 pr-3">Person</th>
                <th className="py-2.5 px-3 text-right">Paid</th>
                <th className="py-2.5 px-3 text-right">Share</th>
                <th className="py-2.5 pl-3 text-right">Net Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-violet-200/50 text-sm">
              {state.balances.netBalances.map((row) => (
                <tr key={row.memberId}>
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-slate-900">{row.name}</div>
                    <div className="text-xs text-slate-600">
                      {row.isShadow ? 'Invited friend' : `@${row.handle}`}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                    {formatPkr(row.paidMinor)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                    {formatPkr(row.owedMinor)}
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <div
                      className={`font-mono tabular-nums font-bold ${
                        row.netMinor === 0
                          ? 'text-slate-700'
                          : row.netMinor > 0
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                      }`}
                    >
                      {formatPkr(row.netMinor)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {row.netMinor > 0
                        ? 'Gets back'
                        : row.netMinor < 0
                          ? 'Owes'
                          : 'Settled'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Gentle Reminders (Mint Card) */}
      <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <Bell className="w-4 h-4 text-violet-700" />
              <span>Gentle Reminders</span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Quiet hours {String(state.group.quietHoursStart).padStart(2, '0')}:00–
              {String(state.group.quietHoursEnd).padStart(2, '0')}:00 ·{' '}
              {state.group.reminderCooldownHours}h cooldown
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSnooze(12)}
              className="min-h-[44px] px-3.5 py-1.5 rounded-xl border border-emerald-200 bg-white/80 text-xs font-semibold text-slate-700 hover:bg-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <BellOff className="w-3.5 h-3.5 text-amber-600" />
              <span>Snooze 12h</span>
            </button>
            {currentMember?.snoozedUntil && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSnooze(0)}
                className="min-h-[44px] px-3.5 py-1.5 rounded-xl border border-emerald-200 bg-white/80 text-xs font-semibold text-slate-700"
              >
                Resume
              </button>
            )}
            {isHostOrAdmin && (
              <button
                type="button"
                onClick={() => setShowReminderSettings((v) => !v)}
                className="min-h-[44px] px-3.5 py-1.5 rounded-xl border border-violet-200 bg-[#F4F0FD] text-xs font-semibold text-violet-800 flex items-center gap-1.5"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Rules</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {state.reminderStatuses
            .filter((r) => r.owedMinor > 0)
            .map((r) => (
              <div
                key={r.memberId}
                className="rounded-2xl bg-white/80 border border-emerald-200/70 p-3.5 flex items-start justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {r.name}{' '}
                    <span className="font-mono tabular-nums text-xs text-rose-600 ml-1">
                      owes {formatPkr(r.owedMinor)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{r.reason}</p>
                  {r.nextAllowedAt && (
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                      Next ready: {formatTimestamp(r.nextAllowedAt)}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs font-semibold shrink-0 ${
                    r.eligible ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {r.eligible ? 'Ready' : 'Paused'}
                </span>
              </div>
            ))}
        </div>

        {isHostOrAdmin && showReminderSettings && (
          <div className="pt-3 border-t border-emerald-200/70 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Quiet Start
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietStart}
                  onChange={(e) => setQuietStart(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl bg-white/90 border border-emerald-200 px-2.5 text-sm font-mono text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Quiet End
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl bg-white/90 border border-emerald-200 px-2.5 text-sm font-mono text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Cooldown (h)
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={cooldownHours}
                  onChange={(e) => setCooldownHours(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl bg-white/90 border border-emerald-200 px-2.5 text-sm font-mono text-slate-900"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onUpdateReminderSettings({
                  quietHoursStart: quietStart,
                  quietHoursEnd: quietEnd,
                  reminderCooldownHours: cooldownHours,
                })
              }
              className="min-h-[44px] px-4 py-2 rounded-xl border border-emerald-200 bg-white text-xs font-semibold text-slate-800 hover:bg-emerald-50"
            >
              Save Reminder Rules
            </button>
          </div>
        )}

        {isHostOrAdmin && state.reminderStatuses.some((r) => r.owedMinor > 0) && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const res = await onSendReminders();
              setDispatchLog(res);
            }}
            className="w-full sm:w-auto min-h-[46px] px-5 py-2.5 rounded-2xl bg-gradient-to-r from-violet-700 to-emerald-700 hover:from-violet-600 hover:to-emerald-600 text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Summary Reminder</span>
          </button>
        )}

        {dispatchLog.length > 0 && (
          <div className="rounded-2xl bg-[#F4F0FD] border border-violet-200 p-3.5 space-y-2 text-xs">
            <div className="font-semibold text-slate-900">Reminder Summary</div>
            {dispatchLog.map((entry) => (
              <div key={entry.memberId} className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800">{entry.name}</span>
                <span className="text-slate-600">{entry.summaryText ?? entry.reason}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
