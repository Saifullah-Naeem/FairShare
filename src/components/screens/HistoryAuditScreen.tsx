import React, { useMemo, useState } from 'react';
import { Ban, Paperclip, Search, Shield } from 'lucide-react';
import type { LedgerState } from '../../types/ledger';
import { formatPkr, formatTimestamp } from '../../utils/currency';

interface HistoryAuditScreenProps {
  state: LedgerState;
  onVoidExpense: (expenseId: number, reason: string) => Promise<void>;
  busy: boolean;
}

type HistoryFilter = 'all' | 'active' | 'voided' | 'settlements' | 'audit';

export const HistoryAuditScreen: React.FC<HistoryAuditScreenProps> = ({
  state,
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
      if (!query) return true;
      return (
        exp.title.toLowerCase().includes(query) ||
        exp.paidByName.toLowerCase().includes(query) ||
        exp.category.toLowerCase().includes(query)
      );
    });
  }, [state.expenses, filter, query]);

  const filteredSettlements = useMemo(() => {
    if (filter !== 'all' && filter !== 'settlements') return [];
    return state.settlements.filter((st) => {
      if (!query) return true;
      return (
        st.fromName.toLowerCase().includes(query) ||
        st.toName.toLowerCase().includes(query) ||
        (st.note ?? '').toLowerCase().includes(query)
      );
    });
  }, [state.settlements, filter, query]);

  const filteredAudit = useMemo(() => {
    if (filter !== 'audit') return [];
    return state.auditLogs.filter((log) => {
      if (!query) return true;
      return (
        log.actionType.toLowerCase().includes(query) ||
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
        err instanceof Error ? err.message : 'Unable to void expense.',
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter & Search Bar */}
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800">
            {(
              [
                ['all', 'All Activity'],
                ['active', 'Active Bills'],
                ['voided', 'Voided Bills'],
                ['settlements', 'Settlements'],
                ['audit', `Audit Log (${state.auditLogs.length})`],
              ] as Array<[HistoryFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  filter === key
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative md:w-64">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter history or actor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-[40px] rounded-xl bg-slate-900 border border-slate-700/80 pl-9 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300">
          {errorMsg}
        </div>
      )}

      {/* Expenses List */}
      {filteredExpenses.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-300 px-1">
            Expenses ({filteredExpenses.length})
          </h2>
          {filteredExpenses.map((exp) => {
            const canVoid =
              exp.status === 'ACTIVE' &&
              (currentMember?.role === 'HOST' ||
                currentMember?.role === 'ADMIN' ||
                currentMember?.memberId === exp.paidByMemberId);

            return (
              <div
                key={exp.id}
                className="rounded-2xl bg-[#131C2E] border border-slate-800 p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className={`text-base font-semibold ${
                          exp.status === 'VOIDED'
                            ? 'line-through text-slate-500'
                            : 'text-slate-100'
                        }`}
                      >
                        {exp.title}
                      </h3>
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
                  <div className="font-mono text-base font-bold text-slate-100 shrink-0">
                    {formatPkr(exp.totalMinor)}
                  </div>
                </div>

                {/* Split Breakdown */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
                  {exp.splits.map((sp) => (
                    <span key={sp.memberId}>
                      {sp.memberName}:{' '}
                      <span className="font-mono text-slate-200">
                        {formatPkr(sp.amountMinor)}
                      </span>
                    </span>
                  ))}
                </div>

                {exp.voidReason && (
                  <div className="text-xs text-rose-300">
                    Voided by {exp.voidedByName ?? 'Admin'}: {exp.voidReason}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  {exp.receiptPath ? (
                    <a
                      href={exp.receiptPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>View Receipt Proof</span>
                    </a>
                  ) : (
                    <span />
                  )}

                  {exp.status === 'ACTIVE' && (
                    <div>
                      {voidingExpenseId === exp.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            placeholder="Reason for voiding (required)"
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            className="min-h-[38px] rounded-lg bg-slate-950 border border-slate-700 px-3 text-xs text-slate-100 w-56"
                          />
                          <button
                            type="button"
                            disabled={busy || voidReason.trim().length < 3}
                            onClick={() => void handleConfirmVoid(exp.id)}
                            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40"
                          >
                            Confirm Void
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setVoidingExpenseId(null);
                              setVoidReason('');
                            }}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : canVoid ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setVoidingExpenseId(exp.id)}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl border border-rose-500/30 hover:border-rose-500/60 text-rose-300 text-xs font-medium flex items-center gap-1.5"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Void Expense</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          Only {exp.paidByName}, HOST, or ADMIN can void
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Settlements in Combined / Settlements Filter */}
      {filteredSettlements.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-300 px-1">
            Settlements ({filteredSettlements.length})
          </h2>
          <div className="rounded-2xl bg-[#131C2E] border border-slate-800 divide-y divide-slate-800">
            {filteredSettlements.map((st) => (
              <div
                key={st.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div>
                  <div className="text-sm font-medium text-slate-100">
                    {st.fromName} → {st.toName}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    <span
                      className={`font-semibold ${
                        st.status === 'CONFIRMED'
                          ? 'text-emerald-400'
                          : st.status === 'PENDING_CONFIRMATION'
                            ? 'text-amber-300'
                            : 'text-rose-400'
                      }`}
                    >
                      {st.status}
                    </span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>{formatTimestamp(st.updatedAt)}</span>
                    {st.note && (
                      <>
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        <span>{st.note}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="font-mono text-sm font-bold text-slate-100">
                  {formatPkr(st.amountMinor)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Append-Only Audit Log */}
      {filter === 'audit' && (
        <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Append-Only Audit Trail</span>
            </h2>
            <span className="text-xs text-slate-400">
              Immutable ledger events
            </span>
          </div>

          <div className="divide-y divide-slate-800/80">
            {filteredAudit.map((log) => (
              <div key={log.id} className="py-3 first:pt-1 last:pb-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-emerald-300">
                      {log.actionType}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-200">{log.actorName}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-400">
                      {log.entityType} #{log.entityId ?? '—'}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">
                    {formatTimestamp(log.createdAt)}
                  </span>
                </div>
                <pre className="font-mono text-[11px] text-slate-400 bg-slate-950/70 rounded-lg px-3 py-2 overflow-x-auto">
                  {JSON.stringify(log.payload)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {filteredExpenses.length === 0 &&
        filteredSettlements.length === 0 &&
        filteredAudit.length === 0 && (
          <div className="rounded-2xl bg-[#131C2E] border border-slate-800 p-10 text-center text-sm text-slate-400">
            No ledger entries match the current filter.
          </div>
        )}
    </div>
  );
};
