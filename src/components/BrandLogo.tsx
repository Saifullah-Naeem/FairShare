import React from 'react';
import {
  Compass,
  Home,
  Users,
  Utensils,
  Wallet,
  Zap,
} from 'lucide-react';
import type { GroupAccentTheme, GroupIconKey } from '../types/ledger';

export const BrandLogo: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({
  size = 'md',
}) => {
  const dim =
    size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-14 h-14' : 'w-9 h-9';

  return (
    <div
      className={`${dim} relative inline-flex items-center justify-center shrink-0 select-none`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        className="w-full h-full drop-shadow-xs"
      >
        <defs>
          <linearGradient id="fsOrbitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6EE7B7" />
            <stop offset="50%" stopColor="#A7F3D0" />
            <stop offset="100%" stopColor="#C4B5FD" />
          </linearGradient>
          <linearGradient id="fsCoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>

        {/* Animated rotating split-ledger ring */}
        <g className="animate-logo-orbit">
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke="url(#fsOrbitGrad)"
            strokeWidth="2.6"
            strokeDasharray="34 12 22 12"
            strokeLinecap="round"
          />
        </g>

        {/* Pulsing split-coin core */}
        <g className="animate-logo-core">
          <rect
            x="11"
            y="11"
            width="26"
            height="26"
            rx="9"
            fill="url(#fsCoreGrad)"
          />
          <path
            d="M24 14V34M16 24H32"
            stroke="#FFFFFF"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeOpacity="0.95"
          />
          <circle cx="19.5" cy="19.5" r="2.2" fill="#A7F3D0" />
          <circle cx="28.5" cy="28.5" r="2.2" fill="#DDD6FE" />
        </g>
      </svg>
    </div>
  );
};

export const GROUP_ICON_OPTIONS: Array<{
  key: GroupIconKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'home', label: 'Room', icon: Home },
  { key: 'compass', label: 'Trip', icon: Compass },
  { key: 'utensils', label: 'Food', icon: Utensils },
  { key: 'users', label: 'Squad', icon: Users },
  { key: 'bolt', label: 'Bills', icon: Zap },
  { key: 'wallet', label: 'Shared', icon: Wallet },
];

export const GROUP_THEME_OPTIONS: Array<{
  key: GroupAccentTheme;
  label: string;
  dotClass: string;
  chipActiveClass: string;
  chipIdleClass: string;
  badgeClass: string;
}> = [
  {
    key: 'emerald',
    label: 'Mint',
    dotClass: 'bg-emerald-500',
    chipActiveClass: 'bg-gradient-to-r from-emerald-700 to-teal-700 text-white border-transparent shadow-sm',
    chipIdleClass: 'bg-[#EFFBF5] text-emerald-900 border-emerald-200 hover:border-emerald-400',
    badgeClass: 'bg-emerald-500/20 text-emerald-100 border-emerald-300/30',
  },
  {
    key: 'violet',
    label: 'Lilac',
    dotClass: 'bg-violet-500',
    chipActiveClass: 'bg-gradient-to-r from-violet-700 to-purple-700 text-white border-transparent shadow-sm',
    chipIdleClass: 'bg-[#F4F0FD] text-violet-900 border-violet-200 hover:border-violet-400',
    badgeClass: 'bg-violet-500/25 text-violet-100 border-violet-300/30',
  },
  {
    key: 'teal',
    label: 'Teal',
    dotClass: 'bg-teal-500',
    chipActiveClass: 'bg-gradient-to-r from-teal-700 to-emerald-700 text-white border-transparent shadow-sm',
    chipIdleClass: 'bg-[#EDFDFB] text-teal-900 border-teal-200 hover:border-teal-400',
    badgeClass: 'bg-teal-500/25 text-teal-100 border-teal-300/30',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    dotClass: 'bg-indigo-500',
    chipActiveClass: 'bg-gradient-to-r from-indigo-700 to-violet-700 text-white border-transparent shadow-sm',
    chipIdleClass: 'bg-[#F0F2FE] text-indigo-900 border-indigo-200 hover:border-indigo-400',
    badgeClass: 'bg-indigo-500/25 text-indigo-100 border-indigo-300/30',
  },
  {
    key: 'rose',
    label: 'Berry',
    dotClass: 'bg-rose-500',
    chipActiveClass: 'bg-gradient-to-r from-rose-600 to-violet-700 text-white border-transparent shadow-sm',
    chipIdleClass: 'bg-[#FDF1F5] text-rose-900 border-rose-200 hover:border-rose-400',
    badgeClass: 'bg-rose-500/25 text-rose-100 border-rose-300/30',
  },
];

export function getGroupIconComponent(
  key?: GroupIconKey,
): React.ComponentType<{ className?: string }> {
  return (
    GROUP_ICON_OPTIONS.find((item) => item.key === key)?.icon ?? Home
  );
}

export function getGroupThemeConfig(key?: GroupAccentTheme) {
  return (
    GROUP_THEME_OPTIONS.find((item) => item.key === key) ??
    GROUP_THEME_OPTIONS[0]
  );
}
