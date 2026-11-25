import React, { useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LedgerState } from '../../types/ledger';
import { formatPkr } from '../../utils/currency';

interface ShadowInviteScreenProps {
  state: LedgerState;
  onAddByHandle: (handle: string) => Promise<void>;
  onInviteUnregistered: (name: string) => Promise<{ inviteCode: string }>;
  onReissueInvite: (memberId: number) => Promise<{ inviteCode: string }>;
  busy: boolean;
}

export const ShadowInviteScreen: React.FC<ShadowInviteScreenProps> = ({
  state,
  onAddByHandle,
  onInviteUnregistered,
  onReissueInvite,
  busy,
}) => {
  const [existingHandle, setExistingHandle] = useState('');
  const [friendName, setFriendName] = useState('');
  const [latestCode, setLatestCode] = useState<{
    name: string;
    code: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const currentMember = state.members.find(
    (m) => m.memberId === state.currentMemberId,
  );
  const isHostOrAdmin =
    currentMember?.role === 'HOST' || currentMember?.role === 'ADMIN';

  const handleAddExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await onAddByHandle(existingHandle.trim());
      setStatusMessage(`Added @${existingHandle.trim().replace(/^@/, '')} to ${state.group.name}.`);
      setExistingHandle('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to add member.');
    }
  };

  const handleInviteFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    const trimmed = friendName.trim();
    try {
      const res = await onInviteUnregistered(trimmed);
      setLatestCode({ name: trimmed, code: res.inviteCode });
      setFriendName('');
      setCopied(false);
      setStatusMessage(
        `${trimmed} added! Share the invite code below so they can claim their profile anytime.`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to invite friend.');
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      {statusMessage && (
        <div className="rounded-2xl bg-[#EFFBF5] border border-emerald-300 px-4 py-3 text-xs font-semibold text-emerald-900">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-2xl bg-rose-100 border border-rose-300 px-4 py-3 text-xs font-semibold text-rose-800">
          {errorMessage}
        </div>
      )}

      {latestCode && (
        <section className="rounded-3xl bg-gradient-to-r from-[#EFFBF5] to-[#F4F0FD] border border-violet-300 p-5 space-y-2.5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-violet-800">
              <KeyRound className="w-4 h-4" />
              <span>Single-Use Invite Code for {latestCode.name}</span>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyCode(latestCode.code)}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
          <div className="font-mono text-lg font-bold text-slate-900 tracking-wide">
            {latestCode.code}
          </div>
          <p className="text-xs text-slate-600">
            They can tap <strong>Invite Code</strong> on the sign-in screen to claim this profile and keep all their shared bills.
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Add Friends */}
        <div className="space-y-4">
          <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Add Friend with Account
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              If your roommate already has a FairShare username, add them right away.
            </p>
            <form onSubmit={(e) => void handleAddExisting(e)} className="flex gap-2">
              <input
                type="text"
                required
                disabled={!isHostOrAdmin || busy}
                placeholder="@username"
                value={existingHandle}
                onChange={(e) => setExistingHandle(e.target.value)}
                className="flex-1 min-h-[44px] rounded-2xl bg-white/85 border border-emerald-200 px-3.5 text-sm text-slate-900 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isHostOrAdmin || busy || !existingHandle.trim()}
                className="min-h-[44px] px-4 rounded-2xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
              >
                Add
              </button>
            </form>
          </section>

          <section className="rounded-3xl bg-[#F4F0FD]/95 border border-violet-200/80 p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-violet-700" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Add Friend Without Account
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              Split bills with them today and send them a single-use invite code to join whenever they&apos;re ready.
            </p>
            <form onSubmit={(e) => void handleInviteFriend(e)} className="flex gap-2">
              <input
                type="text"
                required
                minLength={2}
                maxLength={60}
                disabled={!isHostOrAdmin || busy}
                placeholder="Friend's name (e.g. Bilal)"
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                className="flex-1 min-h-[44px] rounded-2xl bg-white/85 border border-violet-200 px-3.5 text-sm text-slate-900 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!isHostOrAdmin || busy || friendName.trim().length < 2}
                className="min-h-[44px] px-4 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold disabled:opacity-40 whitespace-nowrap"
              >
                Create Invite
              </button>
            </form>
            {!isHostOrAdmin && (
              <p className="text-xs text-slate-500">
                Only a group Host or Admin can add or invite new roommates.
              </p>
            )}
          </section>
        </div>

        {/* Group Roommates Roster (Mint Card) */}
        <section className="rounded-3xl bg-[#EFFBF5]/95 border border-emerald-200/80 p-5 space-y-3 shadow-xs">
          <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-700" />
            <span>People in {state.group.name} ({state.members.length})</span>
          </h3>

          <div className="divide-y divide-emerald-200/60">
            {state.members.map((m) => {
              const net = state.balances.netBalances.find(
                (n) => n.memberId === m.memberId,
              );
              return (
                <div
                  key={m.memberId}
                  className="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {m.name}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      <span>{m.role === 'HOST' ? 'Host' : m.role === 'ADMIN' ? 'Admin' : 'Member'}</span>
                      <span aria-hidden="true" className="mx-1.5">·</span>
                      <span>
                        {m.isShadow ? 'Pending invite' : `@${m.handle}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="font-mono tabular-nums text-xs font-bold text-slate-800">
                      {formatPkr(net?.netMinor ?? 0)}
                    </span>
                    {m.isShadow && isHostOrAdmin && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setErrorMessage(null);
                          try {
                            const res = await onReissueInvite(m.memberId);
                            setLatestCode({ name: m.name, code: res.inviteCode });
                            setCopied(false);
                          } catch (err) {
                            setErrorMessage(
                              err instanceof Error
                                ? err.message
                                : 'Unable to generate code.',
                            );
                          }
                        }}
                        className="min-h-[38px] px-2.5 py-1 rounded-xl border border-violet-200 bg-[#F4F0FD] text-violet-800 text-xs font-semibold flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>New Code</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
