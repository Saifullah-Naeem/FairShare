import React, { useState } from 'react';
import {
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Send,
  ShieldCheck,
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
  onSendReminders: (testHour?: number) => Promise<
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
  const [testHourInput, setTestHourInput] = useState<string>('');
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
    <div className="space-y-6">
      {/* Net Balances Ledger Table */}
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Zero-Sum Net Balances
            </h2>
            <p className="text-xs text-slate-400">
              Positive means others owe this roommate; negative means this roommate owes the group.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Sum Check: {formatPkr(state.balances.zeroSumCheckMinor)}</span>
          </div>
        </div>

        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full text-left border-collapse min-w-[540px]">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-400 font-medium">
                <th className="py-2.5 pr-3">Member</th>
                <th className="py-2.5 px-3 text-right">Paid</th>
                <th className="py-2.5 px-3 text-right">Expense Share</th>
                <th className="py-2.5 px-3 text-right">Settled Net</th>
                <th className="py-2.5 pl-3 text-right">Net Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-sm">
              {state.balances.netBalances.map((row) => {
                const settledNet = row.settledOutMinor - row.settledInMinor;
                return (
                  <tr key={row.memberId} className="hover:bg-slate-800/30">
                    <td className="py-3 pr-3">
                      <div className="font-medium text-slate-100">{row.name}</div>
                      <div className="text-xs text-slate-500">
                        {row.role} · {row.isShadow ? 'Shadow' : `@${row.handle}`}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-300">
                      {formatPkr(row.paidMinor)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-300">
                      {formatPkr(row.owedMinor)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-400">
                      {formatPkr(settledNet)}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <div
                        className={`font-mono font-semibold ${
                          row.netMinor === 0
                            ? 'text-slate-300'
                            : row.netMinor > 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {formatPkr(row.netMinor)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {row.netMinor > 0
                          ? 'Owed to member'
                          : row.netMinor < 0
                            ? 'Owes group'
                            : 'Settled'}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Settlement Plan vs Raw Pair Balances */}
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-100">
              {planView === 'simplified'
                ? 'Simplified Debt-Settlement Plan'
                : 'Raw Pairwise Balances'}
            </h3>
            <p className="text-xs text-slate-400">
              {planView === 'simplified'
                ? `Minimizes transfers to ${state.balances.simplifiedPlan.length} payments to clear all group debts.`
                : `Shows direct pairwise obligations (${state.balances.rawPairBalances.length} pairs) before graph simplification.`}
            </p>
          </div>

          <div className="inline-flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 self-start">
            <button
              type="button"
              onClick={() => setPlanView('simplified')}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                planView === 'simplified'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Simplified ({state.balances.simplifiedPlan.length})
            </button>
            <button
              type="button"
              onClick={() => setPlanView('raw')}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                planView === 'raw'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Raw Pairs ({state.balances.rawPairBalances.length})
            </button>
          </div>
        </div>

        {activeTransfers.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            <span>Everyone in the group is completely settled up.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeTransfers.map((edge) => (
              <div
                key={`${edge.fromMemberId}-${edge.toMemberId}`}
                className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    <span className="truncate">{edge.fromName}</span>
                    <ArrowRight className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{edge.toName}</span>
                  </div>
                  <div className="mt-1 font-mono text-base font-bold text-emerald-300">
                    {formatPkr(edge.amountMinor)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onStartSettle(edge)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-xs font-semibold text-emerald-300 whitespace-nowrap shrink-0"
                >
                  Record Payment
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Non-Spam Reminders (Quiet Hours, Cooldown, Snooze, Batched Summary) */}
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
              <Bell className="w-4 h-4 text-emerald-400" />
              <span>Non-Spam Batched Reminders</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Enforces quiet hours ({String(state.group.quietHoursStart).padStart(2, '0')}:00–{String(state.group.quietHoursEnd).padStart(2, '0')}:00), {state.group.reminderCooldownHours}h cooldown, and personal snooze before sending a single batched summary.
            </p>
          </div>

          {currentMember && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSnooze(12)}
                className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-900 text-xs font-medium text-slate-200 hover:border-slate-600 flex items-center gap-1.5 whitespace-nowrap"
              >
                <BellOff className="w-3.5 h-3.5 text-amber-400" />
                <span>Snooze Mine (12h)</span>
              </button>
              {currentMember.snoozedUntil && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onSnooze(0)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-700 text-xs text-slate-300 hover:text-white whitespace-nowrap"
                >
                  Unsnooze
                </button>
              )}
            </div>
          )}
        </div>

        {/* Debtor Eligibility Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {state.reminderStatuses
            .filter((r) => r.owedMinor > 0)
            .map((r) => (
              <div
                key={r.memberId}
                className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100">
                    {r.name}{' '}
                    <span className="font-mono text-xs text-rose-400 ml-1">
                      owes {formatPkr(r.owedMinor)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{r.reason}</p>
                  {r.nextAllowedAt && (
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                      Next eligible: {formatTimestamp(r.nextAllowedAt)}
                    </p>
                  )}
                </div>
                <span
                  className={`text-xs font-semibold shrink-0 ${
                    r.eligible ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {r.eligible ? 'Eligible' : 'Suppressed'}
                </span>
              </div>
            ))}
        </div>

        {/* HOST / ADMIN Rules & Dispatch */}
        <div className="pt-4 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
              <span>Group Quiet Hours &amp; Cooldown (HOST / ADMIN)</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Quiet Start (0–23)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  disabled={!isHostOrAdmin || busy}
                  value={quietStart}
                  onChange={(e) => setQuietStart(Number(e.target.value))}
                  className="w-full min-h-[40px] rounded-lg bg-slate-900 border border-slate-700 px-2.5 text-sm font-mono text-slate-100 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Quiet End (0–23)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  disabled={!isHostOrAdmin || busy}
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(Number(e.target.value))}
                  className="w-full min-h-[40px] rounded-lg bg-slate-900 border border-slate-700 px-2.5 text-sm font-mono text-slate-100 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Cooldown (hrs)
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  disabled={!isHostOrAdmin || busy}
                  value={cooldownHours}
                  onChange={(e) => setCooldownHours(Number(e.target.value))}
                  className="w-full min-h-[40px] rounded-lg bg-slate-900 border border-slate-700 px-2.5 text-sm font-mono text-slate-100 disabled:opacity-50"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={!isHostOrAdmin || busy}
              onClick={() =>
                void onUpdateReminderSettings({
                  quietHoursStart: quietStart,
                  quietHoursEnd: quietEnd,
                  reminderCooldownHours: cooldownHours,
                })
              }
              className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-700 hover:border-slate-600 text-xs font-medium text-slate-200 disabled:opacity-50"
            >
              Save Reminder Rules
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Dispatch Batched Summary</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={testHourInput}
                onChange={(e) => setTestHourInput(e.target.value)}
                disabled={!isHostOrAdmin || busy}
                className="min-h-[44px] rounded-xl bg-slate-900 border border-slate-700 px-3 text-xs text-slate-200"
              >
                <option value="">Use Real Server Hour</option>
                <option value="14">Simulate Daytime (14:00)</option>
                <option value="23">Simulate Quiet Hours (23:00)</option>
              </select>
              <button
                type="button"
                disabled={!isHostOrAdmin || busy}
                onClick={async () => {
                  const res = await onSendReminders(
                    testHourInput === '' ? undefined : Number(testHourInput),
                  );
                  setDispatchLog(res);
                }}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Batched Summary</span>
              </button>
            </div>
            {!isHostOrAdmin && (
              <p className="text-xs text-slate-500">
                Switch perspective to HOST or ADMIN to dispatch or configure group reminders.
              </p>
            )}
          </div>
        </div>

        {dispatchLog.length > 0 && (
          <div className="rounded-xl bg-slate-900/80 border border-slate-800 p-3.5 space-y-2 text-xs">
            <div className="font-semibold text-slate-200">Last Batch Dispatch Result</div>
            {dispatchLog.map((entry) => (
              <div key={entry.memberId} className="flex flex-col gap-0.5 border-t border-slate-800/80 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-100">{entry.name}</span>
                  <span className={entry.status === 'SENT' ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
                    {entry.status}
                  </span>
                </div>
                <div className="text-slate-400">{entry.summaryText ?? entry.reason}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
