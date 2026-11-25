import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { LedgerState } from '../../types/ledger';
import { formatPkr, formatTimestamp } from '../../utils/currency';

interface ShadowInviteScreenProps {
  state: LedgerState;
  prefilledToken: string;
  onInviteShadow: (name: string) => Promise<{ claimToken: string | null }>;
  onClaimShadow: (params: {
    claimToken: string;
    handle: string;
    password: string;
    displayName?: string;
  }) => Promise<void>;
  onLogin: (handle: string, password: string) => Promise<void>;
  busy: boolean;
}

export const ShadowInviteScreen: React.FC<ShadowInviteScreenProps> = ({
  state,
  prefilledToken,
  onInviteShadow,
  onClaimShadow,
  onLogin,
  busy,
}) => {
  const [shadowName, setShadowName] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [claimToken, setClaimToken] = useState(prefilledToken);
  const [claimHandle, setClaimHandle] = useState('');
  const [claimDisplayName, setClaimDisplayName] = useState('');
  const [claimPassword, setClaimPassword] = useState('');
  const [loginHandle, setLoginHandle] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (prefilledToken) {
      setClaimToken(prefilledToken);
    }
  }, [prefilledToken]);

  const currentMember = state.members.find(
    (m) => m.memberId === state.currentMemberId,
  );
  const isHostOrAdmin =
    currentMember?.role === 'HOST' || currentMember?.role === 'ADMIN';

  const shadowMembers = state.members.filter((m) => m.isShadow);
  const claimedMembers = state.members.filter((m) => !m.isShadow);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await onInviteShadow(shadowName.trim());
      setShadowName('');
      setIssuedToken(res.claimToken);
      if (res.claimToken) {
        setClaimToken(res.claimToken);
      }
      setStatusMessage(
        'Shadow member created. Historical splits can be assigned immediately.',
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to invite shadow member.',
      );
    }
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await onClaimShadow({
        claimToken: claimToken.trim(),
        handle: claimHandle.trim(),
        password: claimPassword,
        displayName: claimDisplayName.trim() || undefined,
      });
      setStatusMessage(
        'Shadow account claimed! All historical splits and balances were preserved, and the token is now permanently locked.',
      );
      setClaimToken('');
      setClaimHandle('');
      setClaimDisplayName('');
      setClaimPassword('');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to claim shadow account.',
      );
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await onLogin(loginHandle.trim(), loginPassword);
      setLoginHandle('');
      setLoginPassword('');
      setStatusMessage('Signed in successfully.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-xs text-emerald-300">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-300">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Invite Shadow Member */}
        <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-400" />
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Add Shadow ("Ghost") Member
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Add an unregistered roommate by name so you can split bills right away. A single-use expiring claim token is issued to let them take ownership later.
          </p>

          <form onSubmit={(e) => void handleInvite(e)} className="space-y-3">
            <div>
              <label
                htmlFor="shadow-name"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Friend's Name
              </label>
              <input
                id="shadow-name"
                type="text"
                required
                minLength={2}
                maxLength={60}
                disabled={!isHostOrAdmin || busy}
                placeholder="e.g. Zainab Farooq"
                value={shadowName}
                onChange={(e) => setShadowName(e.target.value)}
                className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={!isHostOrAdmin || busy || shadowName.trim().length < 2}
              className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-40"
            >
              Generate Shadow Profile &amp; Token
            </button>
            {!isHostOrAdmin && (
              <p className="text-xs text-slate-500">
                Switch perspective to HOST or ADMIN to add new shadow members.
              </p>
            )}
          </form>

          {issuedToken && (
            <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/40 p-3.5 text-xs space-y-1">
              <div className="font-semibold text-emerald-300">
                Single-Use Claim Token Issued
              </div>
              <div className="font-mono text-sm font-bold text-slate-100">
                {issuedToken}
              </div>
              <div className="text-slate-400">
                Pre-filled in the Claim form on the right. Consumed permanently once claimed.
              </div>
            </div>
          )}

          {/* Active Shadow Roster */}
          <div className="pt-3 border-t border-slate-800 space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-300">
              Unclaimed Shadow Profiles ({shadowMembers.length})
            </h3>
            {shadowMembers.length === 0 ? (
              <p className="text-xs text-slate-500">
                All group members have claimed their accounts.
              </p>
            ) : (
              shadowMembers.map((m) => {
                const net = state.balances.netBalances.find(
                  (n) => n.memberId === m.memberId,
                );
                return (
                  <div
                    key={m.memberId}
                    className="rounded-xl bg-slate-900/70 border border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        {m.name}
                      </div>
                      <div className="text-xs text-slate-400">
                        Pending claim · Net{' '}
                        <span className="font-mono text-slate-200">
                          {formatPkr(net?.netMinor ?? 0)}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-amber-300 font-medium flex items-center gap-1">
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Unclaimed</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Claim Shadow Account + Sign In */}
        <div className="space-y-6">
          <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="font-display text-lg font-semibold text-slate-100">
                Claim Shadow Account
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Enter your single-use invite token to bind a handle and password. Past expense splits remain intact, and the token is immediately invalidated to prevent takeovers.
            </p>

            <form onSubmit={(e) => void handleClaim(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="claim-token"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Single-Use Claim Token
                </label>
                <input
                  id="claim-token"
                  type="text"
                  required
                  placeholder="e.g. FS-BILAL-304"
                  value={claimToken}
                  onChange={(e) => setClaimToken(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm font-mono text-slate-100 placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="claim-handle"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Choose @Handle
                  </label>
                  <input
                    id="claim-handle"
                    type="text"
                    required
                    placeholder="bilal"
                    value={claimHandle}
                    onChange={(e) => setClaimHandle(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="claim-display"
                    className="block text-xs font-medium text-slate-300 mb-1.5"
                  >
                    Display Name (Optional)
                  </label>
                  <input
                    id="claim-display"
                    type="text"
                    placeholder="Keep existing name"
                    value={claimDisplayName}
                    onChange={(e) => setClaimDisplayName(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="claim-password"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Set Password (min 6 chars)
                </label>
                <input
                  id="claim-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={claimPassword}
                  onChange={(e) => setClaimPassword(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3.5 text-sm text-slate-100"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                <span>Claim &amp; Lock Account</span>
              </button>
            </form>
          </section>

          {/* Claimed Roster & Credential Sign-In */}
          <section className="rounded-2xl bg-[#131C2E] border border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Claimed Accounts ({claimedMembers.length})</span>
              </h3>
              <span className="text-[11px] text-slate-500">Demo password: demo1234</span>
            </div>

            <div className="divide-y divide-slate-800/80 text-xs">
              {claimedMembers.map((m) => (
                <div
                  key={m.memberId}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-medium text-slate-200">{m.name}</span>
                    <span className="text-slate-500 ml-2">@{m.handle} · {m.role}</span>
                  </div>
                  <span className="text-slate-500 font-mono">
                    {m.claimedAt ? formatTimestamp(m.claimedAt) : 'Active'}
                  </span>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => void handleSignIn(e)}
              className="pt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-2"
            >
              <input
                type="text"
                placeholder="@handle"
                value={loginHandle}
                onChange={(e) => setLoginHandle(e.target.value)}
                className="min-h-[40px] rounded-xl bg-slate-900 border border-slate-700/80 px-3 text-xs text-slate-100"
              />
              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="min-h-[40px] rounded-xl bg-slate-900 border border-slate-700/80 px-3 text-xs text-slate-100"
              />
              <button
                type="submit"
                disabled={busy}
                className="min-h-[40px] rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-900 text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
