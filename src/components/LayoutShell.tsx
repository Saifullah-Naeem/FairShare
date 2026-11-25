import React, { useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  History,
  KeyRound,
  LayoutDashboard,
  PlusCircle,
  RotateCcw,
  ShieldAlert,
  Terminal,
  UserCheck,
  X,
} from 'lucide-react';
import type { GroupMember, ScreenId, VerificationTokenItem } from '../types/ledger';

interface LayoutShellProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  groupName: string;
  members: GroupMember[];
  currentMember: GroupMember | null;
  pendingCount: number;
  devTokens: VerificationTokenItem[];
  verificationMode: 'dev_mock' | 'production_stub';
  onSwitchMember: (memberId: number) => Promise<void>;
  onResetDemo: () => Promise<void>;
  onPrefillClaimToken: (token: string) => void;
  busy: boolean;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: ScreenId;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Group Overview', shortLabel: 'Overview', icon: LayoutDashboard },
  { id: 'balances', label: 'Balances & Plan', shortLabel: 'Balances', icon: ArrowLeftRight },
  { id: 'add-expense', label: 'Add Expense', shortLabel: 'Add', icon: PlusCircle },
  { id: 'settlements', label: 'Settlement Queue', shortLabel: 'Settle', icon: CheckCircle2 },
  { id: 'shadow', label: 'Shadow & Claim', shortLabel: 'Shadow', icon: UserCheck },
  { id: 'history', label: 'History & Audit', shortLabel: 'Audit', icon: History },
];

export const LayoutShell: React.FC<LayoutShellProps> = ({
  activeScreen,
  onNavigate,
  groupName,
  members,
  currentMember,
  pendingCount,
  devTokens,
  verificationMode,
  onSwitchMember,
  onResetDemo,
  onPrefillClaimToken,
  busy,
  children,
}) => {
  const [showDevBanner, setShowDevBanner] = useState(true);
  const [showPerspectiveDrawer, setShowPerspectiveDrawer] = useState(false);

  const currentScreenTitle =
    NAV_ITEMS.find((item) => item.id === activeScreen)?.label ?? 'FairShare Ledger';

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar Rail */}
      <aside className="hidden lg:flex lg:w-68 lg:shrink-0 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0D1322] border-r border-slate-800/90">
        <div className="px-6 py-5 border-b border-slate-800/80">
          <div className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap">
            FairShare Ledger
          </div>
          <p className="mt-1 text-xs text-slate-400 truncate">{groupName}</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors min-h-[44px] whitespace-nowrap ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'settlements' && pendingCount > 0 && (
                  <span className="font-mono text-xs font-semibold text-amber-300 ml-2">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          <div>
            <label
              htmlFor="desktop-perspective-select"
              className="block text-xs font-medium text-slate-400 mb-1.5"
            >
              Active Perspective
            </label>
            <select
              id="desktop-perspective-select"
              value={currentMember?.memberId ?? ''}
              disabled={busy}
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id) void onSwitchMember(id);
              }}
              className="w-full min-h-[44px] rounded-xl bg-slate-900 border border-slate-700/80 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {members
                .filter((m) => !m.isShadow)
                .map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.name} · {m.role}
                  </option>
                ))}
            </select>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void onResetDemo()}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-600 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo Data</span>
          </button>
        </div>
      </aside>

      {/* Mobile Compact Sticky Top Bar (52px <= 15% combined cap) */}
      <header className="sticky top-0 z-30 h-13 lg:hidden flex items-center justify-between px-4 bg-[#0D1322]/90 backdrop-blur-md border-b border-slate-800/90">
        <button
          type="button"
          onClick={() => onNavigate('overview')}
          className="font-display text-base font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 min-h-[44px] flex items-center"
        >
          FairShare Ledger
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowPerspectiveDrawer(true)}
            className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 text-xs font-medium text-slate-200 whitespace-nowrap max-w-[165px] truncate"
          >
            {currentMember ? `${currentMember.name.split(' ')[0]} · ${currentMember.role}` : 'Select Member'}
          </button>
          <button
            type="button"
            aria-label="Reset Demo Data"
            disabled={busy}
            onClick={() => void onResetDemo()}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <div className="flex-1 lg:pl-68 flex flex-col min-w-0">
        {/* Desktop Top Context Bar (3-zone contract) */}
        <header className="hidden lg:flex items-center justify-between gap-8 px-8 py-4 border-b border-slate-800/80 bg-[#0B101C]/80 backdrop-blur-md sticky top-0 z-20">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold text-slate-50 truncate">
              {currentScreenTitle}
            </h1>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-400 whitespace-nowrap shrink-0">
            <span>{currentMember ? `${currentMember.name} · ${currentMember.role}` : 'Guest'}</span>
            <span aria-hidden="true">·</span>
            <span>PKR (Paisa Minor Units)</span>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('add-expense')}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Add Expense</span>
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-5 pb-24 lg:px-8 lg:py-6 lg:pb-10 space-y-5">
          {/* Scope & Demo Environment Notice + Dev Mock Verification Banner */}
          <div className="space-y-3">
            <div className="rounded-2xl bg-[#111827] border border-slate-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-300">
              <div className="flex items-start sm:items-center gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                <span>
                  <strong className="font-semibold text-slate-100">Demo Environment:</strong>{' '}
                  Portfolio concept only. No real money is processed and no paid SMS/email gateways are called.
                </span>
              </div>
              {verificationMode === 'dev_mock' && devTokens.length > 0 && !showDevBanner && (
                <button
                  type="button"
                  onClick={() => setShowDevBanner(true)}
                  className="text-emerald-400 hover:text-emerald-300 font-medium whitespace-nowrap self-start sm:self-auto"
                >
                  Show Dev Tokens ({devTokens.length})
                </button>
              )}
            </div>

            {verificationMode === 'dev_mock' && showDevBanner && devTokens.length > 0 && (
              <div className="rounded-2xl bg-emerald-950/30 border border-emerald-500/30 px-4 py-3 text-xs">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                    <Terminal className="w-4 h-4 shrink-0" />
                    <span>Dev Mock Verification Provider — Active Single-Use Tokens</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Hide Dev Verification Banner"
                    onClick={() => setShowDevBanner(false)}
                    className="p-1 text-slate-400 hover:text-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {devTokens.map((tok) => (
                    <div
                      key={tok.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-slate-900/70 border border-slate-800/90 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-100">{tok.recipientLabel}</span>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <code className="font-mono text-emerald-300 font-semibold">
                            {tok.token}
                          </code>
                        </div>
                        <p className="text-slate-400 mt-0.5 truncate">{tok.detail}</p>
                      </div>
                      {tok.purpose === 'SHADOW_CLAIM' && (
                        <button
                          type="button"
                          onClick={() => {
                            onPrefillClaimToken(tok.token);
                            onNavigate('shadow');
                          }}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-medium whitespace-nowrap shrink-0 flex items-center gap-1.5 self-start sm:self-auto"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Use Claim Token</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {children}
        </main>
      </div>

      {/* Mobile Fixed Thumb-Zone Bottom Navigation Bar (64px) */}
      <nav
        aria-label="Mobile Screen Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-[#0D1322]/95 backdrop-blur-md border-t border-slate-800/90 pb-safe"
      >
        <div className="grid grid-cols-6 items-center h-16">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`relative flex flex-col items-center justify-center min-h-[44px] h-full px-1 transition-colors ${
                  active ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
                  {item.shortLabel}
                </span>
                {item.id === 'settlements' && pendingCount > 0 && (
                  <span className="absolute top-1.5 right-2.5 font-mono text-[10px] font-bold text-amber-300">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Perspective Bottom Sheet */}
      {showPerspectiveDrawer && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-black/60 backdrop-blur-sm flex items-end"
          onClick={() => setShowPerspectiveDrawer(false)}
        >
          <div
            className="w-full rounded-t-3xl bg-[#131C2E] border-t border-slate-700 p-5 pb-8 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto" />
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-100">
                Switch Active Perspective
              </h2>
              <button
                type="button"
                onClick={() => setShowPerspectiveDrawer(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Test role permissions (HOST, ADMIN, MEMBER, Payer) enforced by the backend.
            </p>
            <div className="space-y-2">
              {members.map((m) => (
                <button
                  key={m.memberId}
                  type="button"
                  disabled={m.isShadow || busy}
                  onClick={async () => {
                    await onSwitchMember(m.memberId);
                    setShowPerspectiveDrawer(false);
                  }}
                  className={`w-full min-h-[48px] px-4 py-3 rounded-xl border text-left flex items-center justify-between transition-colors ${
                    currentMember?.memberId === m.memberId
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
                      : m.isShadow
                        ? 'bg-slate-900/40 border-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-slate-900/80 border-slate-800 text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-slate-400">
                      {m.isShadow ? 'Unclaimed Shadow Member' : `${m.role} · @${m.handle}`}
                    </div>
                  </div>
                  {currentMember?.memberId === m.memberId && (
                    <span className="text-xs font-semibold text-emerald-400">Active</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
