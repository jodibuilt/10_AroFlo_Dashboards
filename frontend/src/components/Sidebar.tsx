import React, { useEffect, useState } from 'react';
import { NavigationTab, AuthUser } from '../types';
import { useIsDesktop } from '../hooks/useMediaQuery';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  user: AuthUser;
  onLogout: () => void;
  hiddenTabs: string[];
  isAdmin: boolean;
  onManageNav: () => void;
  // Mobile drawer state — below `lg` the sidebar is off-canvas.
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export interface NavItem {
  tab: NavigationTab;
  label: string;
  icon: string;
  isActive?: (tab: NavigationTab) => boolean;
}

export interface NavCategory {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
}

// Same collapsible-category structure as test_all_aroflo's sidebar, cut down
// to the two sections this app ships. The report panes are listed directly
// rather than as sub-tabs of a single "Reports" tab.
export const NAV_CATEGORIES: NavCategory[] = [
  {
    key: 'dashboards',
    label: 'Dashboards',
    icon: 'space_dashboard',
    items: [
      { tab: 'matrix', label: 'KPI Matrix', icon: 'table_chart' },
      { tab: 'analytics', label: 'Work Orders', icon: 'analytics' },
      { tab: 'invoicing', label: 'Invoicing', icon: 'receipt_long' },
    ],
  },
  {
    key: 'tools',
    label: 'Tools',
    icon: 'build',
    items: [{ tab: 'tools', label: 'WO Consolidator', icon: 'call_merge' }],
  },
];

function categoryOf(tab: NavigationTab): string | undefined {
  return NAV_CATEGORIES.find((c) => c.items.some((i) => (i.isActive ? i.isActive(tab) : i.tab === tab)))?.key;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  user,
  onLogout,
  hiddenTabs,
  isAdmin,
  onManageNav,
  mobileOpen,
  onMobileClose,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(NAV_CATEGORIES.map((c) => c.key)));
  const isDesktop = useIsDesktop();

  // Escape closes the mobile drawer; lock background scroll while it's open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen, onMobileClose]);

  // The rail-collapse affordance only exists on desktop; the mobile drawer is
  // always the full-width layout.
  const collapsed = isCollapsed && isDesktop;

  const hiddenSet = new Set(hiddenTabs);
  // Hidden tabs never render in the sidebar, admins included — "Manage
  // navigation" (NavSettingsModal) lists the full tab catalog independently
  // of this list, so admins can still reach and unhide them from there.
  const visibleCategories = NAV_CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter((i) => !hiddenSet.has(i.tab)),
  })).filter((cat) => cat.items.length > 0);

  const toggleCategory = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Selecting a destination on mobile should dismiss the drawer.
  const selectTab = (tab: NavigationTab) => {
    onSelectTab(tab);
    if (!isDesktop) onMobileClose();
  };

  const activeCategory = categoryOf(currentTab);

  const navButtonClass = (isActive: boolean, indent: boolean) =>
    `w-full flex items-center gap-3 py-2.5 text-left transition-colors duration-200 rounded-md ${
      indent ? 'pl-9 pr-4' : 'px-4'
    } ${isActive ? 'bg-accent text-white font-bold shadow-xs' : 'text-chrome-text hover:bg-chrome-line hover:text-white'}`;

  return (
    <>
      {/* Backdrop — only rendered while the drawer is open on small screens. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={onMobileClose}
        />
      )}

      <aside
        id="app-sidebar"
        aria-label="Primary"
        className={`on-chrome h-dvh fixed left-0 top-0 overflow-y-auto z-50 flex flex-col bg-ink border-r border-chrome-line text-white
          w-[280px] transition-transform duration-300
          lg:transition-[width] lg:translate-x-0 ${collapsed ? 'lg:w-[80px]' : 'lg:w-[280px]'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Brand Header */}
        <div className="px-5 py-6 flex items-center justify-between border-b border-chrome-line">
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-sans text-[19px] font-bold text-white tracking-normal truncate">AroFlo Dashboards</span>
              <span className="font-sans text-[11px] font-semibold text-chrome-text uppercase tracking-widest truncate">
                Reports &amp; Tools
              </span>
            </div>
          )}
          {collapsed && (
            <div className="w-10 h-10 rounded-md bg-accent text-white font-bold text-[18px] flex items-center justify-center mx-auto shrink-0 shadow-sm">
              AF
            </div>
          )}

          {/* Desktop: collapse the rail. */}
          <button
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`hidden lg:inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-chrome-line text-stone-300 hover:text-white transition-colors shrink-0 ${
              collapsed ? 'mx-auto mt-2' : ''
            }`}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              {collapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>

          {/* Mobile: close the drawer. */}
          <button
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="lg:hidden inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-chrome-line text-stone-300 hover:text-white transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 mt-3 space-y-1 px-2" aria-label="Sections">
          {collapsed
            ? // Icon-only mode: no room for category headers, flatten to one list.
              visibleCategories.flatMap((cat) =>
                cat.items.map((item) => {
                  const isActive = item.isActive ? item.isActive(currentTab) : currentTab === item.tab;
                  return (
                    <button
                      key={item.tab}
                      onClick={() => selectTab(item.tab)}
                      aria-label={item.label}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.label}
                      className={navButtonClass(isActive, false).replace('px-4', 'justify-center px-0')}
                    >
                      <span className="material-symbols-outlined text-[20px] shrink-0" aria-hidden="true">
                        {item.icon}
                      </span>
                    </button>
                  );
                })
              )
            : visibleCategories.map((cat) => {
                const isExpanded = expanded.has(cat.key);
                const isCatActive = activeCategory === cat.key;
                return (
                  <div key={cat.key}>
                    <button
                      onClick={() => toggleCategory(cat.key)}
                      aria-expanded={isExpanded}
                      className={`w-full flex items-center gap-3 py-2.5 px-4 text-left rounded-md transition-colors ${
                        isCatActive ? 'text-white' : 'text-chrome-text hover:text-white'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">{cat.icon}</span>
                      <span className="text-[11px] font-bold uppercase tracking-widest truncate flex-1">{cat.label}</span>
                      <span className="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">
                        {isExpanded ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="space-y-0.5 mb-1">
                        {cat.items.map((item) => {
                          const isActive = item.isActive ? item.isActive(currentTab) : currentTab === item.tab;
                          return (
                            <button
                              key={item.tab}
                              onClick={() => selectTab(item.tab)}
                              aria-current={isActive ? 'page' : undefined}
                              className={navButtonClass(isActive, true)}
                            >
                              <span className="material-symbols-outlined text-[18px] shrink-0" aria-hidden="true">{item.icon}</span>
                              <span className="text-[13px] font-semibold tracking-wide truncate flex-1">{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
        </nav>

        {/* Profile & account actions */}
        <div className="p-4 mt-auto border-t border-chrome-line">
          <div className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
            <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center shrink-0 text-white font-bold text-[13px]">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-semibold text-white truncate">{user.displayName}</span>
                <span className="text-[11px] text-chrome-text truncate capitalize">{user.role}</span>
              </div>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={onManageNav}
              aria-label="Manage navigation"
              className={`w-full mt-2 text-chrome-text hover:bg-chrome-line hover:text-white text-[12px] font-semibold py-2.5 rounded-md transition-colors flex items-center justify-center gap-2 ${
                collapsed ? 'px-0' : 'px-4'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">tune</span>
              {!collapsed && <span>Manage navigation</span>}
            </button>
          )}
          <button
            onClick={onLogout}
            aria-label="Sign out"
            className={`w-full mt-2 text-chrome-text hover:bg-chrome-line hover:text-white text-[12px] font-semibold py-2.5 rounded-md transition-colors flex items-center justify-center gap-2 ${
              collapsed ? 'px-0' : 'px-4'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">logout</span>
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
};
