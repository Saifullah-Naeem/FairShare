import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  FileUp,
  Paperclip,
  XCircle,
} from 'lucide-react';
import type { LedgerState, TransferEdge } from '../../types/ledger';
import {
  formatPkr,
  formatPkrInput,
  formatSettlementStatus,
  formatTimestamp,
} from '../../utils/currency';

interface SettlementsQueueScreenProps {
  state: LedgerState;
  prefilledEdge: TransferEdge | null;
  onClearPrefill: () => void;
  onCreateSettlement: (params: {
    fromMemberId: number;
    toMemberId: number;
    amountPkr: string;
    note?: string;
    receiptFile?: File | null;
  }) => Promise<void>;
  onConfirmSettlement: (id: number) => Promise<void>;
  onRejectSettlement: (id: number, reason: string) => Promise<void>;
  onCancelSettlement: (id: number) => Promise<void>;
  busy: boolean;
}

export const SettlementsQueueScreen: React.FC<SettlementsQueueScreenProps> = ({
  state,
  prefilledEdge,
  onClearPrefill,
  onCreateSettlement,
  onConfirmSettlement,
  onRejectSettlement,
  onCancelSettlement,
  busy,
}) => {
  const fallbackTo =
    state.members.find((m) => m.memberId !== state.currentMemberId)?.memberId ??
    state.members[0]?.memberId ??
    1;

  const [fromMemberId, setFromMemberId] = useState<number>(
    prefilledEdge?.fromMemberId ?? state.currentMemberId,
  );
  const [toMemberId, setToMemberId] = useState<number>(
    prefilledEdge?.toMemberId ?? fallbackTo,
  );
  const [amountPkr, setAmountPkr] = useState<string>(
    prefilledEdge ? formatPkrInput(prefilledEdge.amountMinor) : '',
  );
  const [note, setNote] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (prefilledEdge) {
      setFromMemberId(prefilledEdge.fromMemberId);
      setToMemberId(prefilledEdge.toMemberId);
      setAmountPkr(formatPkrInput(prefilledEdge.amountMinor));
    } else {
      setFromMemberId(state.currentMemberId);
      setToMemberId(
        state.members.find((m) => m.memberId !== state.currentMemberId)
          ?.memberId ?? state.currentMemberId,
      );
    }
  }, [prefilledEdge, state.group.id, state.currentMemberId, state.members]);

  const currentMember = state.members.find(
    (m) => m.memberId === state.currentMemberId,
  );
  const isHostOrAdmin =
    currentMember?.role === 'HOST' || currentMember?.role === 'ADMIN';

  const pendingQueue = state.settlements.filter(
    (s) => s.status === 'PENDING_CONFIRMATION',
  );
  const completedHistory = state.settlements.filter(
    (s) => s.status !== 'PENDING_CONFIRMATION',
  );

  const matchingEdge =
    state.balances.rawPairBalances.find(
      (e) => e.fromMemberId === fromMemberId && e.toMemberId === toMemberId,
    ) ??
    state.balances.simplifiedPlan.find(
      (e) => e.fromMemberId === fromMemberId && e.toMemberId === toMemberId,
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (fromMemberId === toMemberId) {
      setErrorMsg('Sender and recipient cannot be the same person.');
      return;
    }
    try {
      await onCreateSettlement({
        fromMemberId,
        toMemberId,
        amountPkr,
        note: note.trim() || undefined,
        receiptFile,
      });
      setAmountPkr('');
      setNote('');
      setReceiptFile(null);
      onClearPrefill();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to record payment.',
      );
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* Left: Record Payment (Mint Card) */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="lg:col-span-5 rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-4 shadow-xs"
      >
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Record a Payment
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Balances update once the person receiving confirms it.
          </p>
        </div>

        {errorMsg && (
          <div className="rounded-2xl bg-rose-100 border border-rose-300 px-3.5 py-2.5 text-xs font-semibold text-rose-800">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="settle-from"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              From
            </label>
            <select
              id="settle-from"
              value={fromMemberId}
              onChange={(e) => setFromMemberId(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-2xl bg-white/85 border border-emerald-200 px-3 text-sm text-slate-900"
            >
              {state.members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="settle-to"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              To
            </label>
            <select
              id="settle-to"
              value={toMemberId}
              onChange={(e) => setToMemberId(Number(e.target.value))}
              className="w-full min-h-[44px] rounded-2xl bg-white/85 border border-emerald-200 px-3 text-sm text-slate-900"
            >
              {state.members.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="settle-amount"
              className="text-xs font-semibold text-slate-700"
            >
              Amount (PKR)
            </label>
            {matchingEdge && (
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() =>
                    setAmountPkr(
                      formatPkrInput(Math.floor(matchingEdge.amountMinor / 2)),
                    )
                  }
                  className="text-violet-700 hover:text-violet-600 font-mono"
                >
                  Half ({formatPkr(Math.floor(matchingEdge.amountMinor / 2))})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAmountPkr(formatPkrInput(matchingEdge.amountMinor))
                  }
                  className="text-emerald-700 hover:text-emerald-600 font-mono"
                >
                  Full ({formatPkr(matchingEdge.amountMinor)})
                </button>
              </div>
            )}
          </div>
          <input
            id="settle-amount"
            type="text"
            inputMode="decimal"
            required
            placeholder="e.g. 500"
            value={amountPkr}
            onChange={(e) => setAmountPkr(e.target.value)}
            className="w-full min-h-[46px] rounded-2xl bg-white/85 border border-emerald-200 px-3.5 text-base font-mono tabular-nums font-semibold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
          />
        </div>

        <div>
          <label
            htmlFor="settle-note"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Note (Optional)
          </label>
          <input
            id="settle-note"
            type="text"
            maxLength={140}
            placeholder="e.g. JazzCash transfer or cash"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full min-h-[44px] rounded-2xl bg-white/85 border border-emerald-200 px-3.5 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div>
          <label
            htmlFor="settle-receipt"
            className="min-h-[44px] w-full rounded-2xl bg-white/75 border border-dashed border-emerald-400 hover:border-emerald-600 px-3.5 flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer"
          >
            <FileUp className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="truncate">
              {receiptFile ? receiptFile.name : 'Attach payment screenshot (optional)'}
            </span>
          </label>
          <input
            id="settle-receipt"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 hover:from-emerald-600 hover:to-violet-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {busy ? 'Sending...' : 'Send Payment for Confirmation'}
        </button>
      </form>

      {/* Right: Approvals Queue & Resolved Payments */}
      <div className="lg:col-span-7 space-y-4">
        <section className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-3 shadow-xs">
          <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span>Waiting for Confirmation ({pendingQueue.length})</span>
          </h3>

          {pendingQueue.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-600">
              No payments waiting for confirmation.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingQueue.map((st) => {
                const canConfirmOrReject =
                  (currentMember?.memberId === st.toMemberId || isHostOrAdmin) &&
                  !(
                    currentMember?.memberId === st.fromMemberId &&
                    currentMember?.role === 'MEMBER'
                  );
                const canCancel =
                  currentMember?.memberId === st.fromMemberId || isHostOrAdmin;

                return (
                  <div
                    key={st.id}
                    className="rounded-2xl bg-gradient-to-r from-amber-50/90 to-white/90 border border-amber-300/70 p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                          <span>{st.fromName}</span>
                          <ArrowRight className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>{st.toName}</span>
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          <span>Waiting for confirmation</span>
                          <span aria-hidden="true" className="mx-1.5">·</span>
                          <span>{formatTimestamp(st.createdAt)}</span>
                        </div>
                      </div>
                      <div className="font-mono tabular-nums text-lg font-bold text-amber-700">
                        {formatPkr(st.amountMinor)}
                      </div>
                    </div>

                    {st.note && (
                      <p className="text-xs text-slate-700">{st.note}</p>
                    )}

                    {st.receiptPath && (
                      <a
                        href={st.receiptPath}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-600"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>View Receipt</span>
                      </a>
                    )}

                    {rejectingId === st.id ? (
                      <div className="pt-2 border-t border-amber-200/70 space-y-2">
                        <input
                          type="text"
                          placeholder="Why are you declining this payment?"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          className="w-full min-h-[44px] rounded-xl bg-white border border-slate-200 px-3 text-xs text-slate-900"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy || rejectReason.trim().length < 3}
                            onClick={async () => {
                              await onRejectSettlement(st.id, rejectReason.trim());
                              setRejectingId(null);
                              setRejectReason('');
                            }}
                            className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-40"
                          >
                            Decline Payment
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(null);
                              setRejectReason('');
                            }}
                            className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-700"
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {canConfirmOrReject && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onConfirmSettlement(st.id)}
                              className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Confirm</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setRejectingId(st.id)}
                              className="min-h-[44px] px-3.5 py-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold flex items-center gap-1.5"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Decline</span>
                            </button>
                          </>
                        )}

                        {canCancel && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onCancelSettlement(st.id)}
                            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-3 shadow-xs">
          <h3 className="font-display text-base font-bold text-slate-900">
            Past Payments ({completedHistory.length})
          </h3>
          {completedHistory.length === 0 ? (
            <p className="text-sm text-slate-600">No confirmed or declined payments yet.</p>
          ) : (
            <div className="divide-y divide-emerald-200/60">
              {completedHistory.map((st) => (
                <div key={st.id} className="py-3 first:pt-1 last:pb-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">
                      {st.fromName} → {st.toName}
                    </div>
                    <div className="font-mono tabular-nums text-sm font-bold text-slate-900">
                      {formatPkr(st.amountMinor)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-semibold ${
                        st.status === 'CONFIRMED'
                          ? 'text-emerald-700'
                          : st.status === 'REJECTED'
                            ? 'text-rose-600'
                            : 'text-slate-600'
                      }`}
                    >
                      {formatSettlementStatus(st.status)}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span className="text-slate-600">
                      {formatTimestamp(st.updatedAt)}
                    </span>
                    {st.actedByName && (
                      <>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="text-slate-600">by {st.actedByName}</span>
                      </>
                    )}
                  </div>
                  {st.note && <p className="text-xs text-slate-700">{st.note}</p>}
                  {st.rejectionReason && (
                    <p className="text-xs text-rose-600">
                      Reason: {st.rejectionReason}
                    </p>
                  )}
                  {st.receiptPath && (
                    <a
                      href={st.receiptPath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-600"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>View Receipt</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
