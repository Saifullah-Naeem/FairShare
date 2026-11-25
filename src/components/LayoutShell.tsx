import React, { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  History,
  Home,
  LogOut,
  Palette,
  Plus,
  PlusCircle,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  GroupAccentTheme,
  GroupIconKey,
  GroupSummary,
  ScreenId,
  UserProfile,
} from '../types/ledger';
import {
  BrandLogo,
  GROUP_ICON_OPTIONS,
  GROUP_THEME_OPTIONS,
  getGroupIconComponent,
  getGroupThemeConfig,
} from './BrandLogo';

interface LayoutShellProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  user: UserProfile;
  groups: GroupSummary[];
  activeGroupId: number;
  canCustomizeGroup: boolean;
  pendingCount: number;
  onSelectGroup: (groupId: number) => Promise<void>;
  onCreateGroup: (params: {
    name: string;
    iconKey: GroupIconKey;
    accentTheme: GroupAccentTheme;
  }) => Promise<void>;
  onUpdateGroupStyle: (params: {
    iconKey: GroupIconKey;
    accentTheme: GroupAccentTheme;
  }) => Promise<void>;
  onSignOut: () => void;
  busy: boolean;
  children: React.ReactNode;
}

export const SWIPE_ORDER: ScreenId[] = [
  'overview',
  'balances',
  'add-expense',
  'settlements',
  'shadow',
  'history',
];

const SCREEN_TITLES: Record<ScreenId, string> = {
  overview: 'Home',
  balances: 'Balances & Plan',
  'add-expense': 'Add Bill',
  settlements: 'Settle Up',
  shadow: 'Roommates',
  history: 'Activity Log',
};

const SIDEBAR_ITEMS: Array<{
  id: ScreenId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Home', icon: Home },
  { id: 'balances', label: 'Balances & Plan', icon: ArrowLeftRight },
  { id: 'add-expense', label: 'Add Bill', icon: PlusCircle },
  { id: 'settlements', label: 'Settle Up', icon: CheckCircle2 },
  { id: 'shadow', label: 'Roommates', icon: UserPlus },
  { id: 'history', label: 'Activity Log', icon: History },
];

export const LayoutShell: React.FC<LayoutShellProps> = ({
  activeScreen,
  onNavigate,
  user,
  groups,
  activeGroupId,
  canCustomizeGroup,
  pendingCount,
  onSelectGroup,
  onCreateGroup,
  onUpdateGroupStyle,
  onSignOut,
  busy,
  children,
}) => {
  const [showNewGroupSheet, setShowNewGroupSheet] = useState(false);
  const [showStyleSheet, setShowStyleSheet] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newIconKey, setNewIconKey] = useState<GroupIconKey>('home');
  const [newAccentTheme, setNewAccentTheme] =
    useState<GroupAccentTheme>('emerald');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const [editIconKey, setEditIconKey] = useState<GroupIconKey>(
    activeGroup?.iconKey ?? 'home',
  );
  const [editAccentTheme, setEditAccentTheme] = useState<GroupAccentTheme>(
    activeGroup?.accentTheme ?? 'emerald',
  );

  const touchStartRef = useRef<{ x: number; y: number; ignore: boolean } | null>(
    null,
  );
  const currentIdx = SWIPE_ORDER.indexOf(activeScreen);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement | null;
    const insideNoSwipe = Boolean(
      target?.closest('[data-no-swipe="true"], input, textarea, select'),
    );
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ignore: insideNoSwipe,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.ignore) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0 && currentIdx < SWIPE_ORDER.length - 1) {
        onNavigate(SWIPE_ORDER[currentIdx + 1]);
      } else if (dx > 0 && currentIdx > 0) {
        onNavigate(SWIPE_ORDER[currentIdx - 1]);
      }
    }
  };

  const handleCreateNewGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupError(null);
    try {
      await onCreateGroup({
        name: newGroupName.trim(),
        iconKey: newIconKey,
        accentTheme: newAccentTheme,
      });
      setNewGroupName('');
      setNewIconKey('home');
      setNewAccentTheme('emerald');
      setShowNewGroupSheet(false);
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : 'Unable to create group.');
    }
  };

  const openStyleEditor = () => {
    setEditIconKey(activeGroup?.iconKey ?? 'home');
    setEditAccentTheme(activeGroup?.accentTheme ?? 'emerald');
    setShowStyleSheet(true);
  };

  return (
    <div className="min-h-screen text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar Rail (Mint & Lilac Tinted) */}
      <aside className="hidden lg:flex lg:w-68 lg:shrink-0 lg:flex-col lg:fixed lg:inset-y-0 bg-gradient-to-b from-[#ECFDF6] via-[#F2F3FB] to-[#F4EEFD] border-r border-emerald-200/80">
        <div className="px-5 py-4 bg-gradient-to-r from-[#064E3B] via-[#0F4C5C] to-[#3B0764] text-white flex items-center gap-3">
          <BrandLogo size="md" />
          <div className="min-w-0">
            <div className="font-display text-base font-bold tracking-tight whitespace-nowrap">
              FairShare Ledger
            </div>
            <p className="text-[11px] text-emerald-100/90 truncate">
              {user.name} · @{user.handle}
            </p>
          </div>
        </div>

        {/* Desktop 1-Tap Group Switcher */}
        <div className="px-4 py-4 border-b border-emerald-200/70 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">Your Groups</span>
            <button
              type="button"
              onClick={() => setShowNewGroupSheet(true)}
              className="text-xs font-bold text-violet-700 hover:text-violet-600 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {groups.map((g) => {
              const active = g.id === activeGroupId;
              const Icon = getGroupIconComponent(g.iconKey);
              const theme = getGroupThemeConfig(g.accentTheme);
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void onSelectGroup(g.id)}
                  className={`w-full min-h-[40px] px-3 py-2 rounded-xl text-left text-xs font-semibold transition-all flex items-center justify-between gap-2 border ${
                    active ? theme.chipActiveClass : theme.chipIdleClass
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{g.name}</span>
                  </span>
                  {g.pendingCount > 0 && (
                    <span className="font-mono text-[11px] opacity-90 shrink-0">
                      {g.pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main Navigation">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeScreen === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors min-h-[44px] whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-r from-emerald-700 to-violet-700 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-white/70'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-200' : 'text-slate-500'}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'settlements' && pendingCount > 0 && (
                  <span className={`font-mono text-xs font-bold ${active ? 'text-emerald-100' : 'text-amber-700'}`}>
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-emerald-200/70">
          <button
            type="button"
            onClick={onSignOut}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-white/80 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Deep Emerald-Violet Header (52px <= 15% cap) */}
      <header className="sticky top-0 z-30 h-13 lg:hidden flex items-center justify-between px-3.5 bg-gradient-to-r from-[#064E3B] via-[#0F4C5C] to-[#3B0764] text-white shadow-sm">
        <button
          type="button"
          onClick={() => onNavigate('overview')}
          className="flex items-center gap-2 min-h-[44px] pr-2 whitespace-nowrap shrink-0"
        >
          <BrandLogo size="sm" />
          <span className="font-display text-sm font-bold tracking-tight text-white">
            FairShare
          </span>
        </button>

        <span className="text-xs font-semibold text-emerald-100 truncate px-2">
          {SCREEN_TITLES[activeScreen]}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label="Activity Log"
            onClick={() => onNavigate('history')}
            className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors ${
              activeScreen === 'history'
                ? 'bg-white/20 text-white'
                : 'text-emerald-100 hover:bg-white/10'
            }`}
          >
            <History className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowAccountMenu(true)}
            className="min-h-[38px] px-2.5 py-1 rounded-xl bg-white/15 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white whitespace-nowrap"
          >
            @{user.handle}
          </button>
        </div>
      </header>

      {/* Main Content Workspace with Swipe Support */}
      <div
        className="flex-1 lg:pl-68 flex flex-col min-w-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Desktop Top Bar (3-zone contract) */}
        <header className="hidden lg:flex items-center justify-between gap-8 px-8 py-3.5 bg-gradient-to-r from-[#064E3B] via-[#0F4C5C] to-[#3B0764] text-white sticky top-0 z-20 shadow-sm">
          <h1 className="font-display text-lg font-bold whitespace-nowrap">
            {SCREEN_TITLES[activeScreen]}
          </h1>

          <div className="flex items-center gap-3 text-xs text-emerald-100 whitespace-nowrap">
            <span>{activeGroup?.name ?? 'Group'}</span>
            <span aria-hidden="true">·</span>
            <span>PKR</span>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('add-expense')}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Bill</span>
          </button>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 pt-3 pb-24 lg:px-8 lg:py-6 lg:pb-10 space-y-4">
          {/* 1-Tap Group Switcher Strip */}
          <div
            data-no-swipe="true"
            className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1"
            aria-label="Group Switcher"
          >
            {groups.map((g) => {
              const active = g.id === activeGroupId;
              const Icon = getGroupIconComponent(g.iconKey);
              const theme = getGroupThemeConfig(g.accentTheme);
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void onSelectGroup(g.id)}
                  className={`min-h-[40px] px-3.5 py-2 rounded-2xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all flex items-center gap-2 border ${
                    active ? theme.chipActiveClass : theme.chipIdleClass
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{g.name}</span>
                  {g.pendingCount > 0 && (
                    <span className="font-mono text-[11px] opacity-90">
                      · {g.pendingCount}
                    </span>
                  )}
                </button>
              );
            })}

            {canCustomizeGroup && (
              <button
                type="button"
                aria-label="Customize group badge"
                onClick={openStyleEditor}
                className="min-h-[40px] px-3 py-2 rounded-2xl bg-[#F4F0FD] hover:bg-violet-100 border border-violet-200 text-xs font-semibold text-violet-800 whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>Badge</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowNewGroupSheet(true)}
              className="min-h-[40px] px-3.5 py-2 rounded-2xl bg-[#EFFBF5] hover:bg-emerald-100 border border-dashed border-emerald-400 text-xs font-semibold text-emerald-800 whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Group</span>
            </button>
          </div>

          {children}
        </main>
      </div>

      {/* Mobile 4 Tabs + Center Raised Add Bill Button */}
      <nav
        aria-label="Mobile Screen Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-gradient-to-r from-[#EFFBF5]/95 via-[#F5F4FC]/95 to-[#F3EEFD]/95 backdrop-blur-md border-t border-emerald-200/80 pb-safe shadow-[0_-4px_20px_rgba(6,78,59,0.08)]"
      >
        <div className="grid grid-cols-5 items-center h-16 px-1">
          {/* Tab 1: Home */}
          <button
            type="button"
            onClick={() => onNavigate('overview')}
            className={`flex flex-col items-center justify-center min-h-[44px] h-full transition-colors ${
              activeScreen === 'overview'
                ? 'text-emerald-800 font-bold'
                : 'text-slate-600'
            }`}
          >
            <Home className={`w-5 h-5 ${activeScreen === 'overview' ? 'text-emerald-700' : ''}`} />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Home</span>
          </button>

          {/* Tab 2: Balances */}
          <button
            type="button"
            onClick={() => onNavigate('balances')}
            className={`flex flex-col items-center justify-center min-h-[44px] h-full transition-colors ${
              activeScreen === 'balances'
                ? 'text-emerald-800 font-bold'
                : 'text-slate-600'
            }`}
          >
            <ArrowLeftRight className={`w-5 h-5 ${activeScreen === 'balances' ? 'text-emerald-700' : ''}`} />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Balances</span>
          </button>

          {/* Center Raised Add Bill CTA */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              aria-label="Add Bill"
              onClick={() => onNavigate('add-expense')}
              className={`-mt-4 w-13 h-13 rounded-2xl flex items-center justify-center shadow-lg transition-transform active:scale-95 ${
                activeScreen === 'add-expense'
                  ? 'bg-gradient-to-br from-violet-700 to-emerald-700 ring-2 ring-violet-300 text-white'
                  : 'bg-gradient-to-br from-emerald-700 to-violet-700 text-white'
              }`}
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>

          {/* Tab 3: Settle */}
          <button
            type="button"
            onClick={() => onNavigate('settlements')}
            className={`relative flex flex-col items-center justify-center min-h-[44px] h-full transition-colors ${
              activeScreen === 'settlements'
                ? 'text-violet-800 font-bold'
                : 'text-slate-600'
            }`}
          >
            <CheckCircle2 className={`w-5 h-5 ${activeScreen === 'settlements' ? 'text-violet-700' : ''}`} />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Settle</span>
            {pendingCount > 0 && (
              <span className="absolute top-1.5 right-3 font-mono text-[10px] font-bold text-amber-700">
                {pendingCount}
              </span>
            )}
          </button>

          {/* Tab 4: Friends */}
          <button
            type="button"
            onClick={() => onNavigate('shadow')}
            className={`flex flex-col items-center justify-center min-h-[44px] h-full transition-colors ${
              activeScreen === 'shadow'
                ? 'text-violet-800 font-bold'
                : 'text-slate-600'
            }`}
          >
            <UserPlus className={`w-5 h-5 ${activeScreen === 'shadow' ? 'text-violet-700' : ''}`} />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Friends</span>
          </button>
        </div>
      </nav>

      {/* Bottom Sheet: Create New Group with Icon & Color */}
      {showNewGroupSheet && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowNewGroupSheet(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-gradient-to-br from-[#EFFBF5] to-[#F4F0FD] border border-emerald-200 p-5 pb-8 sm:pb-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-emerald-200 rounded-full mx-auto sm:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Create New Group
              </h2>
              <button
                type="button"
                onClick={() => setShowNewGroupSheet(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {groupError && (
              <div className="rounded-xl bg-rose-100 border border-rose-300 px-3.5 py-2.5 text-xs font-semibold text-rose-800">
                {groupError}
              </div>
            )}
            <form onSubmit={(e) => void handleCreateNewGroup(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="new-group-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Group Name
                </label>
                <input
                  id="new-group-input"
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="e.g. Murree Weekend Trip"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full min-h-[46px] rounded-2xl bg-white/90 border border-emerald-200 px-3.5 text-sm text-slate-900 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700">Icon</span>
                <div className="flex flex-wrap gap-1.5">
                  {GROUP_ICON_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setNewIconKey(opt.key)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border ${
                          newIconKey === opt.key
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
                <span className="block text-xs font-semibold text-slate-700">Color</span>
                <div className="flex flex-wrap gap-1.5">
                  {GROUP_THEME_OPTIONS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setNewAccentTheme(t.key)}
                      className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 border ${
                        newAccentTheme === t.key
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
                disabled={busy || newGroupName.trim().length < 2}
                className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 hover:from-emerald-600 hover:to-violet-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Creating...' : 'Create & Open Group'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bottom Sheet: Customize Current Group Badge */}
      {showStyleSheet && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowStyleSheet(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-gradient-to-br from-[#EFFBF5] to-[#F4F0FD] border border-violet-200 p-5 pb-8 sm:pb-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-violet-200 rounded-full mx-auto sm:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Customize Group Badge
              </h2>
              <button
                type="button"
                onClick={() => setShowStyleSheet(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-slate-700">Icon</span>
              <div className="flex flex-wrap gap-1.5">
                {GROUP_ICON_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setEditIconKey(opt.key)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border ${
                        editIconKey === opt.key
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
              <span className="block text-xs font-semibold text-slate-700">Color</span>
              <div className="flex flex-wrap gap-1.5">
                {GROUP_THEME_OPTIONS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setEditAccentTheme(t.key)}
                    className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 border ${
                      editAccentTheme === t.key
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
              type="button"
              disabled={busy}
              onClick={async () => {
                await onUpdateGroupStyle({
                  iconKey: editIconKey,
                  accentTheme: editAccentTheme,
                });
                setShowStyleSheet(false);
              }}
              className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Saving...' : 'Save Group Badge'}
            </button>
          </div>
        </div>
      )}

      {/* Mobile Account Sheet */}
      {showAccountMenu && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-slate-900/45 backdrop-blur-xs flex items-end"
          onClick={() => setShowAccountMenu(false)}
        >
          <div
            className="w-full rounded-t-3xl bg-gradient-to-br from-[#EFFBF5] to-[#F4F0FD] border-t border-emerald-200 p-5 pb-8 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-emerald-200 rounded-full mx-auto" />
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  {user.name}
                </h2>
                <p className="text-xs text-slate-500">@{user.handle}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAccountMenu(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAccountMenu(false);
                onSignOut();
              }}
              className="w-full min-h-[48px] rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-semibold flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
