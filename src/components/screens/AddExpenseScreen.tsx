import React, { useMemo, useState } from 'react';
import { Check, FileUp, PlusCircle, Receipt } from 'lucide-react';
import type { LedgerState } from '../../types/ledger';
import {
  computeEqualSplitPreview,
  formatPkr,
  parsePkrInputToPaisa,
} from '../../utils/currency';

interface AddExpenseScreenProps {
  state: LedgerState;
  onSubmitExpense: (params: {
    title: string;
    category: string;
    amountPkr: string;
    paidByMemberId: number;
    splitMode: 'EQUAL' | 'CUSTOM';
    participantMemberIds?: number[];
    customSplits?: Array<{ memberId: number; amountMinor: number }>;
    receiptFile?: File | null;
  }) => Promise<void>;
  busy: boolean;
}

const CATEGORIES = [
  'Food',
  'Utilities',
  'Room Maintenance',
  'Groceries',
  'Transport',
  'General',
];

export const AddExpenseScreen: React.FC<AddExpenseScreenProps> = ({
  state,
  onSubmitExpense,
  busy,
}) => {
  const defaultPayer =
    state.currentMemberId ?? state.members[0]?.memberId ?? 1;

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Food');
  const [amountPkr, setAmountPkr] = useState('');
  const [paidByMemberId, setPaidByMemberId] = useState<number>(defaultPayer);
  const [splitMode, setSplitMode] = useState<'EQUAL' | 'CUSTOM'>('EQUAL');
  const [selectedIds, setSelectedIds] = useState<number[]>(() =>
    state.members.map((m) => m.memberId),
  );
  const [customValues, setCustomValues] = useState<Record<number, string>>({});
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const totalMinor = useMemo(() => {
    const parsed = parsePkrInputToPaisa(amountPkr);
    return parsed && parsed > 0 ? parsed : 0;
  }, [amountPkr]);

  const equalPreview = useMemo(() => {
    return computeEqualSplitPreview(totalMinor, selectedIds);
  }, [totalMinor, selectedIds]);

  const customBreakdown = useMemo(() => {
    const splits: Array<{ memberId: number; amountMinor: number }> = [];
    let allocated = 0;
    let invalidField = false;

    for (const m of state.members) {
      const raw = (customValues[m.memberId] ?? '').trim();
      if (!raw) continue;
      const parsed = parsePkrInputToPaisa(raw);
      if (parsed === null) {
        invalidField = true;
      } else {
        allocated += parsed;
        splits.push({ memberId: m.memberId, amountMinor: parsed });
      }
    }

    return {
      splits,
      allocated,
      remaining: totalMinor - allocated,
      invalidField,
    };
  }, [state.members, customValues, totalMinor]);

  const isCustomValid =
    totalMinor > 0 &&
    !customBreakdown.invalidField &&
    customBreakdown.remaining === 0 &&
    customBreakdown.splits.some((s) => s.amountMinor > 0);

  const isEqualValid = totalMinor > 0 && selectedIds.length > 0;

  const toggleParticipant = (memberId: number) => {
    setSelectedIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    );
  };

  const handleEqualFillCustom = () => {
    if (totalMinor <= 0) return;
    const eq = computeEqualSplitPreview(
      totalMinor,
      state.members.map((m) => m.memberId),
    );
    const next: Record<number, string> = {};
    for (const [id, minor] of eq.entries()) {
      const r = Math.floor(minor / 100);
      const p = minor % 100;
      next[id] = `${r}.${String(p).padStart(2, '0')}`;
    }
    setCustomValues(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setFormError('Enter an expense description.');
      return;
    }
    if (totalMinor <= 0) {
      setFormError('Enter a valid PKR amount greater than Rs. 0.00.');
      return;
    }

    if (splitMode === 'EQUAL' && !isEqualValid) {
      setFormError('Select at least one participant for an equal split.');
      return;
    }
    if (splitMode === 'CUSTOM' && !isCustomValid) {
      setFormError(
        `Custom splits must strictly equal ${formatPkr(totalMinor)}. Remaining delta: ${formatPkr(customBreakdown.remaining)}.`,
      );
      return;
    }

    try {
      await onSubmitExpense({
        title: title.trim(),
        category,
        amountPkr,
        paidByMemberId,
        splitMode,
        participantMemberIds: splitMode === 'EQUAL' ? selectedIds : undefined,
        customSplits: splitMode === 'CUSTOM' ? customBreakdown.splits : undefined,
        receiptFile,
      });
      setTitle('');
      setAmountPkr('');
      setCustomValues({});
      setReceiptFile(null);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to save expense.',
      );
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 max-w-3xl">
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Log Shared Expense
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Amounts are converted strictly to integer paisa (`1 Rs. = 100 paisa`). Active splits must equal total exactly.
          </p>
        </div>

        {formError && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label
              htmlFor="expense-title"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Description
            </label>
            <input
              id="expense-title"
              type="text"
              required
              maxLength={120}
              placeholder="e.g. Monthly K-Electric / Gas Cylinder Refill"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="expense-amount"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Total Amount (PKR Rs.)
            </label>
            <input
              id="expense-amount"
              type="text"
              inputMode="decimal"
              required
              placeholder="e.g. 1250.50"
              value={amountPkr}
              onChange={(e) => setAmountPkr(e.target.value)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
            {totalMinor > 0 && (
              <p className="mt-1 text-[11px] font-mono text-emerald-400">
                Exact minor units: {totalMinor.toLocaleString()} paisa
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="expense-payer"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Paid By
            </label>
            <select
              id="expense-payer"
              value={paidByMemberId}
              onChange={(e) => setPaidByMemberId(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {state.members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name} {m.isShadow ? '(Shadow)' : `(${m.role})`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="expense-category"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Category
            </label>
            <select
              id="expense-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="expense-receipt"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Optional Receipt Proof (JPG, PNG, PDF)
            </label>
            <label
              htmlFor="expense-receipt"
              className="min-h-[44px] w-full rounded-xl bg-slate-900 border border-dashed border-slate-700 hover:border-emerald-500/60 px-3.5 flex items-center justify-between gap-2 text-xs text-slate-300 cursor-pointer"
            >
              <span className="flex items-center gap-2 truncate">
                <FileUp className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">
                  {receiptFile ? receiptFile.name : 'Attach local receipt image/PDF'}
                </span>
              </span>
              {receiptFile && <Receipt className="w-4 h-4 text-emerald-400 shrink-0" />}
            </label>
            <input
              id="expense-receipt"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              className="sr-only"
            />
          </div>
        </div>
      </section>

      {/* Split Distribution Section */}
      <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-100">
              Split Method
            </h3>
            <p className="text-xs text-slate-400">
              Equal splits allocate odd remainder paisa deterministically (+Rs. 0.01) so zero paisa are ever lost.
            </p>
          </div>

          <div className="inline-flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 self-start">
            <button
              type="button"
              onClick={() => setSplitMode('EQUAL')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                splitMode === 'EQUAL'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Equal Split
            </button>
            <button
              type="button"
              onClick={() => setSplitMode('CUSTOM')}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                splitMode === 'CUSTOM'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              Custom Split
            </button>
          </div>
        </div>

        {splitMode === 'EQUAL' ? (
          <div className="space-y-2">
            {state.members.map((m) => {
              const checked = selectedIds.includes(m.memberId);
              const share = equalPreview.get(m.memberId) ?? 0;
              return (
                <button
                  key={m.memberId}
                  type="button"
                  onClick={() => toggleParticipant(m.memberId)}
                  className={`w-full min-h-[48px] px-4 py-2.5 rounded-xl border flex items-center justify-between gap-3 text-left transition-colors ${
                    checked
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-slate-100'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        checked
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'border-slate-600 bg-slate-900'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{m.name}</div>
                      <div className="text-xs text-slate-400">
                        {m.isShadow ? 'Shadow Member' : m.role}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold shrink-0">
                    {checked && totalMinor > 0 ? formatPkr(share) : 'Rs. 0.00'}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span
                className={`font-mono font-semibold ${
                  customBreakdown.remaining === 0 && totalMinor > 0
                    ? 'text-emerald-400'
                    : 'text-amber-300'
                }`}
              >
                Remaining to allocate: {formatPkr(customBreakdown.remaining)}
              </span>
              <button
                type="button"
                disabled={totalMinor <= 0}
                onClick={handleEqualFillCustom}
                className="text-emerald-400 hover:text-emerald-300 font-medium disabled:opacity-40"
              >
                Pre-fill Equal Shares
              </button>
            </div>

            <div className="space-y-2">
              {state.members.map((m) => (
                <div
                  key={m.memberId}
                  className="rounded-xl bg-slate-900/70 border border-slate-800 px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-100 truncate">
                      {m.name}
                    </div>
                    <div className="text-xs text-slate-400">
                      {m.isShadow ? 'Shadow Member' : m.role}
                    </div>
                  </div>
                  <div className="w-36 shrink-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={customValues[m.memberId] ?? ''}
                      onChange={(e) =>
                        setCustomValues((prev) => ({
                          ...prev,
                          [m.memberId]: e.target.value,
                        }))
                      }
                      className="w-full min-h-[40px] rounded-lg bg-slate-950 border border-slate-700 px-3 text-right font-mono text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={
              busy ||
              (splitMode === 'EQUAL' ? !isEqualValid : !isCustomValid)
            }
            className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{busy ? 'Saving Expense...' : 'Save Expense to Ledger'}</span>
          </button>
        </div>
      </section>
    </form>
  );
};
