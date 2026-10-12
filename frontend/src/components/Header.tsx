import React, { useState } from 'react';
import { AuthUser } from '../types';
import { ThemeMode } from '../reporting/theme';
import { Modal } from './Modal';

// Top header: a hamburger (mobile only), the app-wide light/dark switch, a
// Settings dialog (the "Manage users" link, admins only), and the signed-in
// user's initial.
interface HeaderProps {
  onOpenMobileNav: () => void;
  user: AuthUser;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

const THEME_OPTIONS: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: 'light', icon: 'light_mode', label: 'Light theme' },
  { mode: 'dark', icon: 'dark_mode', label: 'Dark theme' },
  { mode: 'system', icon: 'computer', label: 'Match this device' },
];

export const Header: React.FC<HeaderProps> = ({ onOpenMobileNav, user, themeMode, onThemeChange }) => {
  const [showSettings, setShowSettings] = useState(false);
  const isAdmin = user.role === 'admin';

  return (
    <>
      <header className="on-chrome sticky top-0 w-full h-16 z-40 bg-ink border-b border-chrome-line text-white shadow-sm px-4 sm:px-6 flex items-center gap-4">
        {/* Left: mobile nav trigger */}
        <button
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          aria-controls="app-sidebar"
          className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-md text-chrome-text hover:text-white hover:bg-chrome-line transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">menu</span>
        </button>

        {/* Right Action Tools: Theme, Settings, Profile */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
          {/* Theme — applies to the whole app, not just the page in view */}
          <div role="group" aria-label="Theme" className="flex items-center gap-0.5 rounded-md border border-chrome-edge p-0.5">
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.mode}
                onClick={() => onThemeChange(o.mode)}
                aria-label={o.label}
                aria-pressed={themeMode === o.mode}
                title={o.label}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-[5px] transition-colors ${
                  themeMode === o.mode ? 'bg-chrome-edge text-white' : 'text-chrome-text hover:text-white hover:bg-chrome-line'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{o.icon}</span>
              </button>
            ))}
          </div>

          {/* Settings Modal Toggle */}
          {isAdmin && (
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="inline-flex h-11 w-11 items-center justify-center text-chrome-text hover:text-white transition-colors rounded-md hover:bg-chrome-line"
              aria-label="Settings"
              aria-haspopup="dialog"
              aria-expanded={showSettings}
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">settings</span>
            </button>
          )}

          {/* User Profile Avatar */}
          <div className="flex items-center gap-2 pl-2 border-l border-chrome-line">
            <div
              className="w-9 h-9 rounded-full overflow-hidden border border-strong shrink-0 bg-accent flex items-center justify-center text-white font-bold text-[12px]"
              title={`${user.displayName} (${user.role})`}
            >
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* Platform Settings */}
      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Settings" panelClassName="max-w-md">
        <div className="p-6 space-y-4 text-[14px]">
          <div>
            <p className="text-[12px] font-semibold uppercase text-muted mb-1">User Accounts</p>
            <a
              href="/admin.html"
              className="flex items-center justify-between w-full border border-default rounded-md p-2.5 bg-surface text-[13px] text-ink hover:bg-default transition-colors"
            >
              Manage users
              <span className="material-symbols-outlined text-[16px] text-muted" aria-hidden="true">open_in_new</span>
            </a>
          </div>
          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 border border-strong rounded-md text-[13px] font-semibold hover:bg-surface transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
