import React, { useState } from 'react';
import { ArrowRight, KeyRound, LogIn, PlusCircle, UserPlus } from 'lucide-react';
import type { GroupAccentTheme, GroupIconKey } from '../types/ledger';
import {
  BrandLogo,
  GROUP_ICON_OPTIONS,
  GROUP_THEME_OPTIONS,
} from './BrandLogo';

type AuthMode = 'register' | 'login' | 'claim';

interface AuthGateProps {
  onRegister: (params: {
    name: string;
    handle: string;
    password: string;
    initialGroupName?: string;
    iconKey?: GroupIconKey;
    accentTheme?: GroupAccentTheme;
  }) => Promise<void>;
  onLogin: (handle: string, password: string) => Promise<void>;
  onClaimInvite: (params: {
    inviteCode: string;
    handle: string;
    password: string;
    displayName?: string;
  }) => Promise<void>;
  busy: boolean;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  onRegister,
  onLogin,
  onClaimInvite,
  busy,
}) => {
  const [mode, setMode] = useState<AuthMode>('register');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [groupName, setGroupName] = useState('');
  const [iconKey, setIconKey] = useState<GroupIconKey>('home');
  const [accentTheme, setAccentTheme] = useState<GroupAccentTheme>('emerald');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'register') {
        await onRegister({
          name: name.trim(),
          handle: handle.trim(),
          password,
          initialGroupName: groupName.trim() || undefined,
          iconKey,
          accentTheme,
        });
      } else if (mode === 'login') {
        await onLogin(handle.trim(), password);
      } else {
        await onClaimInvite({
          inviteCode: inviteCode.trim(),
          handle: handle.trim(),
          password,
          displayName: name.trim() || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        {/* Deep Emerald-Violet Brand Hero */}
        <div className="rounded-3xl bg-gradient-to-br from-[#064E3B] via-[#0F4C5C] to-[#3B0764] text-white p-5 shadow-lg shadow-emerald-950/15 flex items-center gap-4">
          <BrandLogo size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              FairShare Ledger
            </h1>
            <p className="text-xs text-emerald-100/90 mt-0.5">
              Split roommate &amp; trip bills clearly in PKR.
            </p>
          </div>
        </div>

        {/* Mint-to-Lilac Auth Card */}
        <div className="rounded-3xl bg-gradient-to-br from-[#EFFBF5] via-[#F7F6FC] to-[#F4F0FD] border border-emerald-200/80 shadow-lg shadow-violet-950/5 p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-white/75 border border-emerald-200/70">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`min-h-[42px] rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                mode === 'register'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Sign Up</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`min-h-[42px] rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                mode === 'login'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('claim');
                setError(null);
              }}
              className={`min-h-[42px] rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                mode === 'claim'
                  ? 'bg-violet-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Invite Code</span>
            </button>
          </div>

          {error && (
            <div className="rounded-2xl bg-rose-100/90 border border-rose-300 px-4 py-3 text-xs font-semibold text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            {mode === 'claim' && (
              <div>
                <label
                  htmlFor="auth-invite-code"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Invite Code
                </label>
                <input
                  id="auth-invite-code"
                  type="text"
                  required
                  placeholder="e.g. FS-A1B2C3-D4E5"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-violet-200 px-3.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-violet-500"
                />
              </div>
            )}

            {(mode === 'register' || mode === 'claim') && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {mode === 'claim' ? 'Your Name (Optional)' : 'Full Name'}
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required={mode === 'register'}
                  placeholder="e.g. Hamza Tariq"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-emerald-200 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-handle"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Username
              </label>
              <input
                id="auth-handle"
                type="text"
                required
                placeholder="e.g. hamza"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-emerald-200 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-emerald-200 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {mode === 'register' && (
              <div className="space-y-2.5 pt-1">
                <div>
                  <label
                    htmlFor="auth-group-name"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    First Group Name (Optional)
                  </label>
                  <input
                    id="auth-group-name"
                    type="text"
                    placeholder="e.g. Hostel Room 304 or Murree Trip"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-emerald-200 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                {groupName.trim().length >= 2 && (
                  <div className="rounded-2xl bg-white/75 border border-violet-200/80 p-3 space-y-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {GROUP_ICON_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const active = iconKey === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setIconKey(opt.key)}
                            className={`min-h-[34px] px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1 border ${
                              active
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      {GROUP_THEME_OPTIONS.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setAccentTheme(t.key)}
                          className={`min-h-[32px] px-2.5 rounded-xl text-[11px] font-semibold flex items-center gap-1.5 border ${
                            accentTheme === t.key
                              ? 'border-slate-900 bg-white text-slate-900'
                              : 'border-slate-200 bg-white/60 text-slate-600'
                          }`}
                        >
                          <span className={`w-2.5 h-2.5 rounded-full ${t.dotClass}`} />
                          <span>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className={`w-full min-h-[48px] rounded-2xl text-white text-sm font-semibold shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                mode === 'claim'
                  ? 'bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600'
                  : 'bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600'
              }`}
            >
              <span>
                {busy
                  ? 'Please wait...'
                  : mode === 'register'
                    ? 'Create Account'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Claim & Join Group'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

interface FirstGroupGateProps {
  userName: string;
  onCreateGroup: (params: {
    name: string;
    iconKey: GroupIconKey;
    accentTheme: GroupAccentTheme;
  }) => Promise<void>;
  onSignOut: () => void;
  busy: boolean;
}

export const FirstGroupGate: React.FC<FirstGroupGateProps> = ({
  userName,
  onCreateGroup,
  onSignOut,
  busy,
}) => {
  const [groupName, setGroupName] = useState('');
  const [iconKey, setIconKey] = useState<GroupIconKey>('home');
  const [accentTheme, setAccentTheme] = useState<GroupAccentTheme>('emerald');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onCreateGroup({ name: groupName.trim(), iconKey, accentTheme });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create group.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-3xl bg-gradient-to-br from-[#064E3B] via-[#0F4C5C] to-[#3B0764] text-white p-5 flex items-center gap-3.5 shadow-lg">
          <BrandLogo size="md" />
          <div>
            <p className="text-xs font-medium text-emerald-200">Welcome, {userName}</p>
            <h1 className="font-display text-xl font-bold">Create Your First Group</h1>
          </div>
        </div>

        <div className="rounded-3xl bg-gradient-to-br from-[#EFFBF5] to-[#F4F0FD] border border-emerald-200 shadow-lg p-6 space-y-4">
          {error && (
            <div className="rounded-2xl bg-rose-100 border border-rose-300 px-4 py-3 text-xs font-semibold text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label
                htmlFor="first-group-name"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Group Name
              </label>
              <input
                id="first-group-name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. Hostel Room 304"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-emerald-200 px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-700">
                Group Icon
              </span>
              <div className="flex flex-wrap gap-1.5">
                {GROUP_ICON_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setIconKey(opt.key)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border ${
                        iconKey === opt.key
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white/90 text-slate-700 border-emerald-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-700">
                Badge Color
              </span>
              <div className="flex flex-wrap gap-1.5">
                {GROUP_THEME_OPTIONS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setAccentTheme(t.key)}
                    className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 border ${
                      accentTheme === t.key
                        ? 'border-slate-900 bg-white text-slate-900'
                        : 'border-slate-200 bg-white/70 text-slate-600'
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${t.dotClass}`} />
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || groupName.trim().length < 2}
              className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 hover:from-emerald-600 hover:to-violet-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{busy ? 'Creating...' : 'Create & Open Group'}</span>
            </button>
          </form>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full min-h-[40px] text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            Sign out or switch account
          </button>
        </div>
      </div>
    </div>
  );
};
