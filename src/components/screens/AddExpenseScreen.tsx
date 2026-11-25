import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileUp, PlusCircle, Receipt } from 'lucide-react';
import type { LedgerState } from '../../types/ledger';
import {
  computeEqualSplitPreview,
  formatPkr,
  formatPkrInput,
  parsePkrInputToMinor,
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
  'Bills',
  'Rent',
  'Groceries',
  'Travel',
  'Other',
];

export const AddExpenseScreen: React.FC<AddExpenseScreenProps> = ({
  state,
  onSubmitExpense,
  busy,
}) => {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Food');
  const [amountPkr, setAmountPkr] = useState('');
  const [paidByMemberId, setPaidByMemberId] = useState<number>(
    state.currentMemberId,
  );
  const [splitMode, setSplitMode] = useState<'EQUAL' | 'CUSTOM'>('EQUAL');
  const [selectedIds, setSelectedIds] = useState<number[]>(() =>
    state.members.map((m) => m.memberId),
  );
  const [customValues, setCustomValues] = useState<Record<number, string>>({});
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setPaidByMemberId(state.currentMemberId);
    setSelectedIds(state.members.map((m) => m.memberId));
    setCustomValues({});
  }, [state.group.id, state.currentMemberId, state.members]);

  const totalMinor = useMemo(() => {
    const parsed = parsePkrInputToMinor(amountPkr);
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
      const parsed = parsePkrInputToMinor(raw);
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
      next[id] = formatPkrInput(minor);
    }
    setCustomValues(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setFormError('Enter what this bill was for.');
      return;
    }
    if (totalMinor <= 0) {
      setFormError('Enter a valid PKR amount greater than 0.');
      return;
    }
    if (splitMode === 'EQUAL' && !isEqualValid) {
      setFormError('Choose at least one person to split equally.');
      return;
    }
    if (splitMode === 'CUSTOM' && !isCustomValid) {
      setFormError(
        `Custom shares must total ${formatPkr(totalMinor)}. Left to assign: ${formatPkr(customBreakdown.remaining)}.`,
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
      setFormError(err instanceof Error ? err.message : 'Unable to save bill.');
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-2xl">
      {/* Bill Details (Mint Card) */}
      <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-4 shadow-xs">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Add a Bill
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Enter the PKR total and choose who shares it.
          </p>
        </div>

        {formError && (
          <div className="rounded-2xl bg-rose-100 border border-rose-300 px-4 py-3 text-xs font-semibold text-rose-800">
            {formError}
          </div>
        )}

        <div>
          <label
            htmlFor="expense-title"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            What was it for?
          </label>
          <input
            id="expense-title"
            type="text"
            required
            maxLength={120}
            placeholder="e.g. Dinner Biryani, Wi-Fi Bill, Groceries"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full min-h-[46px] rounded-2xl bg-white/85 border border-emerald-200 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label
              htmlFor="expense-amount"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Amount (PKR)
            </label>
            <input
              id="expense-amount"
              type="text"
              inputMode="decimal"
              required
              placeholder="e.g. 2500"
              value={amountPkr}
              onChange={(e) => setAmountPkr(e.target.value)}
              className="w-full min-h-[46px] rounded-2xl bg-white/85 border border-emerald-200 px-3.5 text-base font-mono tabular-nums font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="expense-payer"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Paid By
            </label>
            <select
              id="expense-payer"
              value={paidByMemberId}
              onChange={(e) => setPaidByMemberId(Number(e.target.value))}
              className="w-full min-h-[46px] rounded-2xl bg-white/85 border border-emerald-200 px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
            >
              {state.members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name} {m.memberId === state.currentMemberId ? '(You)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 1-Tap Category Chips */}
        <div>
          <span className="block text-xs font-semibold text-slate-700 mb-1.5">
            Category
          </span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors border ${
                  category === c
                    ? 'bg-gradient-to-r from-violet-700 to-emerald-700 text-white border-transparent shadow-xs'
                    : 'bg-white/80 text-slate-700 border-emerald-200 hover:border-violet-400'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Receipt Attachment */}
        <div>
          <label
            htmlFor="expense-receipt"
            className="min-h-[44px] w-full rounded-2xl bg-white/75 border border-dashed border-emerald-400 hover:border-emerald-600 px-3.5 flex items-center justify-between gap-2 text-xs font-medium text-slate-700 cursor-pointer"
          >
            <span className="flex items-center gap-2 truncate">
              <FileUp className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="truncate">
                {receiptFile ? receiptFile.name : 'Attach receipt photo or PDF (optional)'}
              </span>
            </span>
            {receiptFile && <Receipt className="w-4 h-4 text-emerald-700 shrink-0" />}
          </label>
          <input
            id="expense-receipt"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </div>
      </section>

      {/* Split Method Card (Lilac Card) */}
      <section className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-slate-900">
              How to Split
            </h3>
            <p className="text-xs text-slate-600">
              Split equally or type exact PKR shares per person.
            </p>
          </div>

          <div className="inline-flex items-center p-1 rounded-2xl bg-white/80 border border-violet-200 self-start">
            <button
              type="button"
              onClick={() => setSplitMode('EQUAL')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                splitMode === 'EQUAL'
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Split Equally
            </button>
            <button
              type="button"
              onClick={() => setSplitMode('CUSTOM')}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                splitMode === 'CUSTOM'
                  ? 'bg-violet-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Custom Amounts
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
                  className={`w-full min-h-[50px] px-4 py-2.5 rounded-2xl border flex items-center justify-between gap-3 text-left transition-colors ${
                    checked
                      ? 'bg-[#EFFBF5] border-emerald-400 text-slate-900'
                      : 'bg-white/75 border-violet-200 text-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        checked
                          ? 'bg-emerald-700 border-emerald-700 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{m.name}</div>
                      <div className="text-xs text-slate-600">
                        {m.isShadow ? 'Invited friend' : `@${m.handle}`}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-sm font-bold shrink-0">
                    {checked && totalMinor > 0 ? formatPkr(share) : 'PKR 0'}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span
                className={`font-mono tabular-nums font-bold ${
                  customBreakdown.remaining === 0 && totalMinor > 0
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
              >
                Left to assign: {formatPkr(customBreakdown.remaining)}
              </span>
              <button
                type="button"
                disabled={totalMinor <= 0}
                onClick={handleEqualFillCustom}
                className="min-h-[36px] text-violet-700 hover:text-violet-600 font-semibold disabled:opacity-40"
              >
                Fill Equal Amounts
              </button>
            </div>

            <div className="space-y-2">
              {state.members.map((m) => (
                <div
                  key={m.memberId}
                  className="rounded-2xl bg-white/80 border border-violet-200 px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {m.name}
                    </div>
                    <div className="text-xs text-slate-600">
                      {m.isShadow ? 'Invited friend' : `@${m.handle}`}
                    </div>
                  </div>
                  <div className="w-36 shrink-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={customValues[m.memberId] ?? ''}
                      onChange={(e) =>
                        setCustomValues((prev) => ({
                          ...prev,
                          [m.memberId]: e.target.value,
                        }))
                      }
                      className="w-full min-h-[44px] rounded-xl bg-white border border-violet-200 px-3 text-right font-mono tabular-nums text-sm font-semibold text-slate-900 focus:outline-none focus:border-violet-600"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={
            busy || (splitMode === 'EQUAL' ? !isEqualValid : !isCustomValid)
          }
          className="w-full min-h-[48px] px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 hover:from-emerald-600 hover:to-violet-600 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 shadow-sm"
        >
          <PlusCircle className="w-4 h-4" />
          <span>{busy ? 'Saving...' : 'Save Bill'}</span>
        </button>
      </section>
    </form>
  );
};
