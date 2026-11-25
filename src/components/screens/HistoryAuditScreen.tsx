import React, { useMemo, useState } from 'react';
import { Ban, Paperclip, Search, Shield, X } from 'lucide-react';
import type { LedgerState } from '../../types/ledger';
import {
  formatAuditAction,
  formatPkr,
  formatSettlementStatus,
  formatTimestamp,
} from '../../utils/currency';

interface HistoryAuditScreenProps {
  state: LedgerState;
  categoryFilter: string | null;
  onClearCategoryFilter: () => void;
  onVoidExpense: (expenseId: number, reason: string) => Promise<void>;
  busy: boolean;
}

type HistoryFilter = 'all' | 'active' | 'voided' | 'settlements' | 'audit';

export const HistoryAuditScreen: React.FC<HistoryAuditScreenProps> = ({
  state,
  categoryFilter,
  onClearCategoryFilter,
  onVoidExpense,
  busy,
}) => {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [search, setSearch] = useState('');
  const [voidingExpenseId, setVoidingExpenseId] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentMember = state.members.find(
    (m) => m.memberId === state.currentMemberId,
  );
  const query = search.trim().toLowerCase();

  const filteredExpenses = useMemo(() => {
    return state.expenses.filter((exp) => {
      if (filter === 'active' && exp.status !== 'ACTIVE') return false;
      if (filter === 'voided' && exp.status !== 'VOIDED') return false;
      if (filter === 'settlements' || filter === 'audit') return false;
      if (
        categoryFilter &&
        exp.category.toLowerCase() !== categoryFilter.toLowerCase()
      ) {
        return false;
      }
      if (!query) return true;
      return (
        exp.title.toLowerCase().includes(query) ||
        exp.paidByName.toLowerCase().includes(query) ||
        exp.category.toLowerCase().includes(query)
      );
    });
  }, [state.expenses, filter, categoryFilter, query]);

  const filteredSettlements = useMemo(() => {
    if (categoryFilter) return [];
    if (filter !== 'all' && filter !== 'settlements') return [];
    return state.settlements.filter((st) => {
      if (!query) return true;
      return (
        st.fromName.toLowerCase().includes(query) ||
        st.toName.toLowerCase().includes(query) ||
        (st.note ?? '').toLowerCase().includes(query)
      );
    });
  }, [state.settlements, filter, categoryFilter, query]);

  const filteredAudit = useMemo(() => {
    if (filter !== 'audit') return [];
    return state.auditLogs.filter((log) => {
      if (!query) return true;
      return (
        formatAuditAction(log.actionType).toLowerCase().includes(query) ||
        log.actorName.toLowerCase().includes(query) ||
        JSON.stringify(log.payload).toLowerCase().includes(query)
      );
    });
  }, [state.auditLogs, filter, query]);

  const handleConfirmVoid = async (expenseId: number) => {
    setErrorMsg(null);
    try {
      await onVoidExpense(expenseId, voidReason.trim());
      setVoidingExpenseId(null);
      setVoidReason('');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to remove bill.',
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar (Mint Card) */}
      <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-4 space-y-3 shadow-xs">
        <div
          data-no-swipe="true"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
        >
          {(
            [
              ['all', 'All'],
              ['active', 'Active Bills'],
              ['voided', 'Removed'],
              ['settlements', 'Payments'],
              ['audit', 'Full Log'],
            ] as Array<[HistoryFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                filter === key
                  ? 'bg-gradient-to-r from-emerald-700 to-violet-700 text-white shadow-xs'
                  : 'bg-white/80 text-slate-700 hover:text-slate-900 border border-emerald-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {categoryFilter && (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-[#F4F0FD] border border-violet-200 px-3.5 py-2 text-xs">
            <span className="font-semibold text-violet-900">
              Showing category: <span className="font-bold">{categoryFilter}</span>
            </span>
            <button
              type="button"
              onClick={onClearCategoryFilter}
              className="min-h-[32px] px-2.5 rounded-lg bg-white/80 hover:bg-white text-violet-800 font-semibold flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search bills, people, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full min-h-[44px] rounded-2xl bg-white/85 border border-emerald-200 pl-9 pr-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white"
          />
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-2xl bg-rose-100 border border-rose-300 px-4 py-3 text-xs font-semibold text-rose-800">
          {errorMsg}
        </div>
      )}

      {filteredExpenses.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-700 px-1">
            Bills ({filteredExpenses.length})
          </h2>
          {filteredExpenses.map((exp, idx) => {
            const canVoid =
              exp.status === 'ACTIVE' &&
              (currentMember?.role === 'HOST' ||
                currentMember?.role === 'ADMIN' ||
                currentMember?.memberId === exp.paidByMemberId);
            const cardTone =
              idx % 2 === 0
                ? 'bg-[#EFFBF5]/95 border-emerald-200/80'
                : 'bg-[#F4F0FD]/95 border-violet-200/80';

            return (
              <div
                key={exp.id}
                className={`rounded-3xl border p-4 sm:p-5 space-y-3 shadow-xs ${cardTone}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className={`text-base font-bold ${
                          exp.status === 'VOIDED'
                            ? 'line-through text-slate-400'
                            : 'text-slate-900'
                        }`}
                      >
                        {exp.title}
                      </h3>
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
                  <div className="font-mono tabular-nums text-base font-bold text-slate-900 shrink-0">
                    {formatPkr(exp.totalMinor)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 pt-2 border-t border-slate-200/60">
                  {exp.splits.map((sp) => (
                    <span key={sp.memberId}>
                      {sp.memberName}:{' '}
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {formatPkr(sp.amountMinor)}
                      </span>
                    </span>
                  ))}
                </div>

                {exp.voidReason && (
                  <div className="text-xs text-rose-700 font-medium">
                    Removed by {exp.voidedByName ?? 'Admin'}: {exp.voidReason}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {exp.receiptPath ? (
                    <a
                      href={exp.receiptPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-600"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>View Receipt</span>
                    </a>
                  ) : (
                    <span />
                  )}

                  {exp.status === 'ACTIVE' && canVoid && (
                    <div>
                      {voidingExpenseId === exp.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            placeholder="Reason for removing (required)"
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            className="min-h-[42px] rounded-xl bg-white border border-slate-200 px-3 text-xs text-slate-900 w-52"
                          />
                          <button
                            type="button"
                            disabled={busy || voidReason.trim().length < 3}
                            onClick={() => void handleConfirmVoid(exp.id)}
                            className="min-h-[42px] px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40"
                          >
                            Confirm Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setVoidingExpenseId(null);
                              setVoidReason('');
                            }}
                            className="min-h-[42px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setVoidingExpenseId(exp.id)}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl border border-rose-200 bg-white/80 text-rose-700 hover:bg-rose-50 text-xs font-semibold flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Remove Bill</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {filteredSettlements.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-700 px-1">
            Payments ({filteredSettlements.length})
          </h2>
          <div className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 divide-y divide-violet-200/60 shadow-xs">
            {filteredSettlements.map((st) => (
              <div
                key={st.id}
                className="p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {st.fromName} → {st.toName}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    <span
                      className={`font-semibold ${
                        st.status === 'CONFIRMED'
                          ? 'text-emerald-700'
                          : st.status === 'PENDING_CONFIRMATION'
                            ? 'text-amber-700'
                            : 'text-rose-600'
                      }`}
                    >
                      {formatSettlementStatus(st.status)}
                    </span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>{formatTimestamp(st.updatedAt)}</span>
                  </div>
                </div>
                <div className="font-mono tabular-nums text-sm font-bold text-slate-900 shrink-0">
                  {formatPkr(st.amountMinor)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {filter === 'audit' && (
        <section className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-3 shadow-xs">
          <h2 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-700" />
            <span>Full Group Activity Log</span>
          </h2>

          <div className="divide-y divide-violet-200/60">
            {filteredAudit.map((log) => (
              <div key={log.id} className="py-3 first:pt-1 last:pb-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-semibold text-emerald-800">
                      {formatAuditAction(log.actionType)}
                    </span>
                    <span aria-hidden="true" className="mx-1.5 text-slate-400">·</span>
                    <span className="font-medium text-slate-900">{log.actorName}</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">
                    {formatTimestamp(log.createdAt)}
                  </span>
                </div>
                <div className="text-xs text-slate-600">
                  {Object.entries(log.payload)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {filteredExpenses.length === 0 &&
        filteredSettlements.length === 0 &&
        filteredAudit.length === 0 && (
          <div className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-10 text-center text-sm text-slate-600">
            No activity matches your filter yet.
          </div>
        )}
    </div>
  );
};
