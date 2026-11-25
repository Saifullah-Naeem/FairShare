import React, { useMemo } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  History,
  PlusCircle,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LedgerState, ScreenId } from '../../types/ledger';
import { formatPkr, formatTimestamp } from '../../utils/currency';
import { getGroupIconComponent, getGroupThemeConfig } from '../BrandLogo';

interface OverviewScreenProps {
  state: LedgerState;
  onNavigate: (screen: ScreenId) => void;
  onSelectCategory: (category: string) => void;
}

const CATEGORY_COLORS: Record<string, { bar: string; dot: string; text: string }> = {
  Food: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  Bills: { bar: 'bg-violet-500', dot: 'bg-violet-500', text: 'text-violet-800' },
  Rent: { bar: 'bg-teal-500', dot: 'bg-teal-500', text: 'text-teal-800' },
  Groceries: { bar: 'bg-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-800' },
  Travel: { bar: 'bg-amber-500', dot: 'bg-amber-500', text: 'text-amber-800' },
  Other: { bar: 'bg-rose-500', dot: 'bg-rose-500', text: 'text-rose-800' },
};

const FALLBACK_PALETTE = [
  { bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-800' },
  { bar: 'bg-violet-500', dot: 'bg-violet-500', text: 'text-violet-800' },
  { bar: 'bg-teal-500', dot: 'bg-teal-500', text: 'text-teal-800' },
  { bar: 'bg-indigo-500', dot: 'bg-indigo-500', text: 'text-indigo-800' },
  { bar: 'bg-amber-500', dot: 'bg-amber-500', text: 'text-amber-800' },
  { bar: 'bg-rose-500', dot: 'bg-rose-500', text: 'text-rose-800' },
];

export const OverviewScreen: React.FC<OverviewScreenProps> = ({
  state,
  onNavigate,
  onSelectCategory,
}) => {
  const currentNet = state.balances.netBalances.find(
    (b) => b.memberId === state.currentMemberId,
  );
  const pendingSettlements = state.settlements.filter(
    (s) => s.status === 'PENDING_CONFIRMATION',
  );
  const activeExpenses = state.expenses.filter((e) => e.status === 'ACTIVE');

  const GroupIcon = getGroupIconComponent(state.group.iconKey);
  const groupTheme = getGroupThemeConfig(state.group.accentTheme);

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<string, { amountMinor: number; count: number }>();
    let grandTotal = 0;

    for (const exp of activeExpenses) {
      const cat = exp.category?.trim() || 'Other';
      const prev = totals.get(cat) ?? { amountMinor: 0, count: 0 };
      totals.set(cat, {
        amountMinor: prev.amountMinor + exp.totalMinor,
        count: prev.count + 1,
      });
      grandTotal += exp.totalMinor;
    }

    const sorted = Array.from(totals.entries())
      .map(([category, data], idx) => ({
        category,
        amountMinor: data.amountMinor,
        count: data.count,
        percent:
          grandTotal > 0
            ? Math.round((data.amountMinor / grandTotal) * 100)
            : 0,
        palette:
          CATEGORY_COLORS[category] ??
          FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length],
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor);

    return { grandTotal, items: sorted };
  }, [activeExpenses]);

  return (
    <div className="space-y-4">
      {/* Deep Emerald-Violet Hero Card */}
      <section className="rounded-3xl bg-gradient-to-br from-[#064E3B] via-[#0F4C5C] to-[#3B0764] text-white shadow-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${groupTheme.badgeClass}`}
            >
              <GroupIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-emerald-100/85">
                {state.members.length} Roommates · {activeExpenses.length} Active Bills
              </div>
              <h2 className="mt-0.5 font-display text-2xl font-bold text-white truncate">
                {state.group.name}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('add-expense')}
            className="min-h-[44px] px-4 py-2 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-bold shadow-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Bill</span>
          </button>
        </div>

        {/* Personal Balance Spotlight + Group Totals */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-white/15">
          <button
            type="button"
            onClick={() => onNavigate('balances')}
            className="col-span-2 sm:col-span-1 text-left rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 p-3.5 transition-colors backdrop-blur-xs"
          >
            <div className="text-xs font-medium text-emerald-100/85">Your Balance</div>
            <div
              className={`mt-1 font-mono tabular-nums text-xl font-bold ${
                !currentNet || currentNet.netMinor === 0
                  ? 'text-white'
                  : currentNet.netMinor > 0
                    ? 'text-emerald-300'
                    : 'text-rose-300'
              }`}
            >
              {currentNet ? formatPkr(currentNet.netMinor) : 'PKR 0'}
            </div>
            <div className="mt-0.5 text-xs font-medium text-emerald-100/85 flex items-center gap-1">
              <span>
                {!currentNet || currentNet.netMinor === 0
                  ? 'All settled up'
                  : currentNet.netMinor > 0
                    ? 'Owed to you · Tap to view'
                    : 'You owe · Tap to settle'}
              </span>
              <ArrowRight className="w-3 h-3" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="text-left rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 p-3.5 transition-colors backdrop-blur-xs"
          >
            <div className="text-xs font-medium text-emerald-100/85">Group Total</div>
            <div className="mt-1 font-mono tabular-nums text-lg font-bold text-white">
              {formatPkr(state.balances.totalActiveSpendMinor)}
            </div>
            <div className="mt-0.5 text-xs text-emerald-100/75">
              {activeExpenses.length} active bills
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('settlements')}
            className="text-left rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 p-3.5 transition-colors backdrop-blur-xs"
          >
            <div className="text-xs font-medium text-violet-100/85">Pending Approvals</div>
            <div className="mt-1 font-mono tabular-nums text-lg font-bold text-amber-300">
              {formatPkr(state.balances.pendingSettlementsMinor)}
            </div>
            <div className="mt-0.5 text-xs text-violet-100/75">
              {pendingSettlements.length} waiting
            </div>
          </button>
        </div>
      </section>

      {/* 1-Tap Quick Actions (Alternating Mint & Lilac Cards) */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => onNavigate('balances')}
          className="min-h-[68px] rounded-2xl bg-[#EFFBF5]/95 border border-emerald-200/80 hover:border-emerald-400 p-3.5 text-left transition-colors flex flex-col justify-between shadow-xs"
        >
          <ArrowLeftRight className="w-5 h-5 text-emerald-700" />
          <div>
            <div className="text-xs font-bold text-slate-900">Balances &amp; Plan</div>
            <div className="text-[11px] text-slate-600">See who owes whom</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('settlements')}
          className="min-h-[68px] rounded-2xl bg-[#F4F0FD]/95 border border-violet-200/80 hover:border-violet-400 p-3.5 text-left transition-colors flex flex-col justify-between shadow-xs"
        >
          <CheckCircle2 className="w-5 h-5 text-violet-700" />
          <div>
            <div className="text-xs font-bold text-slate-900">Settle Up</div>
            <div className="text-[11px] text-slate-600">
              {pendingSettlements.length > 0
                ? `${pendingSettlements.length} waiting approval`
                : 'Record a payment'}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('shadow')}
          className="min-h-[68px] rounded-2xl bg-[#EFFBF5]/95 border border-emerald-200/80 hover:border-emerald-400 p-3.5 text-left transition-colors flex flex-col justify-between shadow-xs"
        >
          <UserPlus className="w-5 h-5 text-emerald-700" />
          <div>
            <div className="text-xs font-bold text-slate-900">Roommates</div>
            <div className="text-[11px] text-slate-600">Add or invite friends</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('history')}
          className="min-h-[68px] rounded-2xl bg-[#F4F0FD]/95 border border-violet-200/80 hover:border-violet-400 p-3.5 text-left transition-colors flex flex-col justify-between shadow-xs"
        >
          <History className="w-5 h-5 text-violet-700" />
          <div>
            <div className="text-xs font-bold text-slate-900">Activity Log</div>
            <div className="text-[11px] text-slate-600">Bills &amp; past changes</div>
          </div>
        </button>
      </section>

      {/* Category Spending Breakdown Chart (Lilac Tinted Card) */}
      <section className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-3.5 shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-700" />
              <span>Where Group Money Went</span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Tap a category to filter its bills in Activity.
            </p>
          </div>
          {categoryBreakdown.grandTotal > 0 && (
            <div className="text-right shrink-0">
              <div className="font-mono tabular-nums text-sm font-bold text-slate-900">
                {formatPkr(categoryBreakdown.grandTotal)}
              </div>
              <div className="text-[11px] text-slate-500">Total active</div>
            </div>
          )}
        </div>

        {categoryBreakdown.items.length === 0 ? (
          <div className="rounded-2xl bg-white/60 border border-violet-100 py-6 px-4 text-center text-xs text-slate-600">
            Add your first PKR bill to see where your group spends the most.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Proportional Stacked Bar */}
            <div
              className="w-full h-3.5 rounded-full overflow-hidden flex bg-white/80 border border-violet-200/70"
              role="img"
              aria-label="Category spending breakdown bar"
            >
              {categoryBreakdown.items.map((item) => {
                const widthPct =
                  categoryBreakdown.grandTotal > 0
                    ? (item.amountMinor / categoryBreakdown.grandTotal) * 100
                    : 0;
                return (
                  <div
                    key={item.category}
                    style={{ width: `${Math.max(widthPct, 2)}%` }}
                    className={`${item.palette.bar} h-full first:rounded-l-full last:rounded-r-full transition-all`}
                    title={`${item.category}: ${formatPkr(item.amountMinor)} (${item.percent}%)`}
                  />
                );
              })}
            </div>

            {/* Clickable Category Breakdown Rows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {categoryBreakdown.items.map((item) => (
                <button
                  key={item.category}
                  type="button"
                  onClick={() => onSelectCategory(item.category)}
                  className="min-h-[46px] rounded-2xl bg-white/75 hover:bg-white border border-violet-200/70 hover:border-violet-400 px-3.5 py-2 flex items-center justify-between gap-3 text-left transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-3 h-3 rounded-full shrink-0 ${item.palette.dot}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {item.category}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {item.count} {item.count === 1 ? 'bill' : 'bills'} ·{' '}
                        <span className="font-mono tabular-nums">{item.percent}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`font-mono tabular-nums text-xs font-bold ${item.palette.text}`}>
                      {formatPkr(item.amountMinor)}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Two-Column Split: Roommates (Mint) + Recent Bills (Lilac) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Roommates Snapshot */}
        <section className="lg:col-span-5 rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-700" />
              <span>Roommates</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('shadow')}
              className="min-h-[36px] px-2 text-xs font-bold text-violet-700 hover:text-violet-600"
            >
              Manage
            </button>
          </div>

          <div className="divide-y divide-emerald-200/60">
            {state.balances.netBalances.map((item) => {
              const isYou = item.memberId === state.currentMemberId;
              return (
                <div
                  key={item.memberId}
                  className="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {item.name}
                      {isYou && (
                        <span className="ml-1.5 text-xs font-semibold text-emerald-700">
                          (You)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {item.isShadow ? 'Invited · Waiting to join' : `@${item.handle}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`font-mono tabular-nums text-sm font-bold ${
                        item.netMinor === 0
                          ? 'text-slate-700'
                          : item.netMinor > 0
                            ? 'text-emerald-700'
                            : 'text-rose-600'
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
                </div>
              );
            })}
          </div>
        </section>

        {/* Recent Bills */}
        <section className="lg:col-span-7 rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900">
              Recent Bills
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="min-h-[36px] px-2 text-xs font-bold text-emerald-700 hover:text-emerald-600 flex items-center gap-1"
            >
              <span>See All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {state.expenses.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-slate-600">
                No bills added to this group yet.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('add-expense')}
                className="min-h-[44px] px-4 py-2 rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 hover:from-emerald-600 hover:to-violet-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Add First Bill</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-violet-200/60">
              {state.expenses.slice(0, 5).map((exp) => (
                <div
                  key={exp.id}
                  className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold truncate ${
                          exp.status === 'VOIDED'
                            ? 'line-through text-slate-400'
                            : 'text-slate-900'
                        }`}
                      >
                        {exp.title}
                      </span>
                      {exp.status === 'VOIDED' && (
                        <span className="text-xs font-semibold text-rose-600">
                          Removed
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      <span>Paid by {exp.paidByName}</span>
                      <span aria-hidden="true" className="mx-1.5">·</span>
                      <span>{exp.category}</span>
                      <span aria-hidden="true" className="mx-1.5">·</span>
                      <span>{formatTimestamp(exp.createdAt)}</span>
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-sm font-bold text-slate-900 shrink-0">
                    {formatPkr(exp.totalMinor)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="w-full min-h-[44px] rounded-2xl bg-white/75 hover:bg-white border border-violet-200 text-xs font-bold text-violet-800 flex items-center justify-center gap-2 transition-colors"
          >
            <History className="w-4 h-4" />
            <span>View Full Activity &amp; Removed Bills</span>
          </button>
        </section>
      </div>
    </div>
  );
};
