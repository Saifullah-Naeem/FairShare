import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  PlusCircle,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LedgerState, ScreenId } from '../../types/ledger';
import { formatPkr, formatTimestamp } from '../../utils/currency';

interface OverviewScreenProps {
  state: LedgerState;
  onNavigate: (screen: ScreenId) => void;
  onSwitchMember: (memberId: number) => Promise<void>;
  onResetDemo: () => Promise<void>;
  busy: boolean;
}

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  state,
  onNavigate,
  onSwitchMember,
  onResetDemo,
  busy,
}) => {
  const [confirmReset, setConfirmReset] = useState(false);

  const currentNet = state.balances.netBalances.find(
    (b) => b.memberId === state.currentMemberId,
  );
  const pendingSettlements = state.settlements.filter(
    (s) => s.status === 'PENDING_CONFIRMATION',
  );
  const activeExpenses = state.expenses.filter((e) => e.status === 'ACTIVE');
  const shadowCount = state.members.filter((m) => m.isShadow).length;

  return (
    <div className="space-y-6">
      {/* Hero Summary Header */}
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs text-slate-400">
              <span>{state.group.currencyCode} Ledger</span>
              <span aria-hidden="true" className="mx-1.5">·</span>
              <span>{state.members.length} Members ({shadowCount} Shadow)</span>
              <span aria-hidden="true" className="mx-1.5">·</span>
              <span>Quiet Hours {String(state.group.quietHoursStart).padStart(2, '0')}:00–{String(state.group.quietHoursEnd).padStart(2, '0')}:00</span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-50 text-balance">
              {state.group.name}
            </h2>
            <p className="text-sm text-slate-400 max-w-2xl">
              Every rupee is persisted in integer paisa minor units. Only confirmed settlements reduce balances, and voided expenses remain preserved in the audit log.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('add-expense')}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Add Expense</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settlements')}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4 text-amber-400" />
              <span>Queue ({pendingSettlements.length})</span>
            </button>
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="mt-6 pt-5 border-t border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-400">Active Group Spend</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-50">
              {formatPkr(state.balances.totalActiveSpendMinor)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {activeExpenses.length} active entries
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400">
              {currentNet ? `${currentNet.name.split(' ')[0]}'s Net Position` : 'Your Net Position'}
            </div>
            <div
              className={`mt-1 font-mono text-xl font-bold ${
                !currentNet || currentNet.netMinor === 0
                  ? 'text-slate-200'
                  : currentNet.netMinor > 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
              }`}
            >
              {currentNet ? formatPkr(currentNet.netMinor) : 'Rs. 0.00'}
            </div>
            <div className="mt-0.5 text-xs text-slate-400">
              {!currentNet || currentNet.netMinor === 0
                ? 'All settled'
                : currentNet.netMinor > 0
                  ? 'Owed to you'
                  : 'You owe group'}
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400">Pending Settlements</div>
            <div className="mt-1 font-mono text-xl font-bold text-amber-300">
              {formatPkr(state.balances.pendingSettlementsMinor)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {pendingSettlements.length} awaiting confirmation
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Zero-Sum Invariant</span>
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-emerald-400">
              {formatPkr(state.balances.zeroSumCheckMinor)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              Net sum across all members
            </div>
          </div>
        </div>
      </section>

      {/* Two-Column Split: Member Roster & Recent Ledger Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Roster */}
        <section className="lg:col-span-5 rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <h3 className="font-display text-base font-semibold text-slate-100">
                Roommates &amp; Roles
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('shadow')}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Shadow Invite</span>
            </button>
          </div>

          <div className="divide-y divide-slate-800/90">
            {state.balances.netBalances.map((item) => {
              const isCurrent = item.memberId === state.currentMemberId;
              return (
                <div
                  key={item.memberId}
                  className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-100 truncate">
                        {item.name}
                      </span>
                      {isCurrent && (
                        <span className="text-xs font-medium text-emerald-400">
                          (You)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      <span>{item.role}</span>
                      <span aria-hidden="true" className="mx-1.5">·</span>
                      <span>
                        {item.isShadow
                          ? 'Shadow (Unclaimed)'
                          : `@${item.handle}`}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 flex items-center gap-3">
                    <div>
                      <div
                        className={`font-mono text-sm font-semibold ${
                          item.netMinor === 0
                            ? 'text-slate-300'
                            : item.netMinor > 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {formatPkr(item.netMinor)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {item.netMinor > 0
                          ? 'Gets back'
                          : item.netMinor < 0
                            ? 'Owes'
                            : 'Settled'}
                      </div>
                    </div>

                    {!item.isShadow && !isCurrent && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onSwitchMember(item.memberId)}
                        className="min-h-[36px] px-2.5 py-1 rounded-lg border border-slate-700 hover:border-slate-600 text-xs text-slate-300 hover:text-white transition-colors whitespace-nowrap"
                      >
                        Act As
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Recent Expenses + Demo Reset */}
        <div className="lg:col-span-7 space-y-6">
          <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-slate-100">
                Recent Ledger Entries
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 flex items-center gap-1 whitespace-nowrap"
              >
                <span>Full History &amp; Audit</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {state.expenses.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No expenses recorded yet. Add the first shared bill.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/90">
                {state.expenses.slice(0, 4).map((exp) => (
                  <div
                    key={exp.id}
                    className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-medium truncate ${
                            exp.status === 'VOIDED'
                              ? 'line-through text-slate-500'
                              : 'text-slate-100'
                          }`}
                        >
                          {exp.title}
                        </span>
                        {exp.status === 'VOIDED' && (
                          <span className="text-xs font-semibold text-rose-400">
                            VOIDED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        <span>Paid by {exp.paidByName}</span>
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        <span>{exp.category}</span>
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        <span>{exp.splitMode}</span>
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        <span>{formatTimestamp(exp.createdAt)}</span>
                      </div>
                    </div>

                    <div className="font-mono text-sm font-semibold text-slate-100 shrink-0">
                      {formatPkr(exp.totalMinor)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* One-Click Demo Reset Panel */}
          <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                One-Click Demo Reset
              </h3>
              <p className="text-xs text-slate-400">
                Wipes SQLite tables and reloads fresh Pakistani hostel roommate bills, shadow token, pending partial payments, and audit logs.
              </p>
            </div>
            {!confirmReset ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-700 hover:border-amber-500/50 bg-slate-900 text-xs font-semibold text-slate-200 hover:text-amber-300 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset Demo Data</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    await onResetDemo();
                    setConfirmReset(false);
                  }}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold whitespace-nowrap"
                >
                  Confirm Wipe &amp; Seed
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
