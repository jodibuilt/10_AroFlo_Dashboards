import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Sidebar, NAV_CATEGORIES } from './components/Sidebar';
import { Header } from './components/Header';
import { NavSettingsModal } from './components/NavSettingsModal';
import { LoginView } from './views/LoginView';
import { NavHidden, NAV_HIDDEN_EMPTY } from './nav';
import { fetchNavHidden, updateNavHidden } from './services/navConfig';
import { AuthError } from './services/api';
import { fetchCurrentUser, logout } from './services/auth';
import { useThemeMode } from './hooks/useThemeMode';
import { ThemeMode } from './reporting/theme';
import { NavigationTab, ReportTab, AuthUser } from './types';
import './dark.css';

// Route views are code-split — each tab's bundle (and its heavy deps, e.g.
// Plotly in Reporting) loads only when first opened, keeping the initial
// payload small.
const ReportingDashboardView = lazy(() =>
  import('./reporting/ReportingDashboardView').then((m) => ({ default: m.ReportingDashboardView }))
);
const ToolsView = lazy(() => import('./tools/ToolsView').then((m) => ({ default: m.ToolsView })));

// Every real NavigationTab value — used to validate the `?tab=` deep-link
// query param below so an unrecognized value can't leave the app on a
// blank screen (no currentTab === X branch would match it).
const REPORT_TABS: ReportTab[] = ['matrix', 'analytics', 'invoicing'];
const VALID_TABS: NavigationTab[] = [...REPORT_TABS, 'tools'];
const DEFAULT_TAB: NavigationTab = 'matrix';

// The report panes were sub-tabs of a single "Reports" sidebar tab before
// they became sidebar tabs themselves, so a saved nav setting can still hold
// the old keys ("reports", "reports:invoicing"). Translate them on load —
// otherwise whatever an admin had hidden would quietly reappear.
function adoptOldReportKeys({ tabs, subTabs }: NavHidden): NavHidden {
  const isOldKey = (k: string) => k.startsWith('reports:');
  return {
    tabs: [
      ...new Set([
        ...tabs.flatMap((t): string[] => (t === 'reports' ? REPORT_TABS : [t])),
        ...subTabs.filter(isOldKey).map((k) => k.slice('reports:'.length)),
      ]),
    ],
    subTabs: subTabs.filter((k) => !isOldKey(k)),
  };
}

interface DashboardsAppProps {
  user: AuthUser;
  onLogout: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

function DashboardsApp({ user, onLogout, themeMode, onThemeChange }: DashboardsAppProps) {
  const resolveInitialTab = (): NavigationTab => {
    const param = new URLSearchParams(window.location.search).get('tab');
    return param && VALID_TABS.includes(param as NavigationTab) ? (param as NavigationTab) : DEFAULT_TAB;
  };
  const [currentTab, setCurrentTab] = useState<NavigationTab>(resolveInitialTab());

  // Keep the URL's ?tab= in sync so a refresh (or bookmark/share) lands back
  // on the same page instead of always resetting to the default — replaceState,
  // not pushState, so normal tab-switching doesn't spam the browser's back
  // button history.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (currentTab === DEFAULT_TAB) {
      params.delete('tab');
    } else {
      params.set('tab', currentTab);
    }
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    window.history.replaceState(null, '', newUrl);
  }, [currentTab]);

  const isAdmin = user.role === 'admin';
  const [navHidden, setNavHidden] = useState<NavHidden>(NAV_HIDDEN_EMPTY);
  const [navModalOpen, setNavModalOpen] = useState(false);
  const [navSaving, setNavSaving] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);

  useEffect(() => {
    fetchNavHidden()
      .then((hidden) => setNavHidden(adoptOldReportKeys(hidden)))
      .catch(() => {});
  }, []);

  // A non-admin sitting on a tab an admin just hid gets moved to the first
  // still-visible tab.
  useEffect(() => {
    if (isAdmin || !navHidden.tabs.includes(currentTab)) return;
    const firstVisible = NAV_CATEGORIES.flatMap((c) => c.items).find((i) => !navHidden.tabs.includes(i.tab));
    setCurrentTab(firstVisible?.tab ?? DEFAULT_TAB);
  }, [isAdmin, navHidden, currentTab]);

  const handleNavChange = (next: NavHidden) => {
    const prev = navHidden;
    setNavHidden(next); // optimistic
    setNavSaving(true);
    setNavError(null);
    updateNavHidden(next)
      .then(setNavHidden)
      .catch((e) => {
        setNavHidden(prev);
        setNavError(e instanceof Error ? e.message : 'Could not save — admin only.');
      })
      .finally(() => setNavSaving(false));
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes (e.g. via a deep link
  // or a nested navigate call that doesn't go through the Sidebar).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [currentTab]);

  return (
    <div className="min-h-screen bg-canvas text-ink font-sans flex antialiased">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Left navigation — fixed rail on desktop, off-canvas drawer below lg */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        user={user}
        onLogout={onLogout}
        hiddenTabs={navHidden.tabs}
        isAdmin={isAdmin}
        onManageNav={() => setNavModalOpen(true)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Main App Container — offset by the rail only from lg up */}
      <div
        className={`flex-1 transition-[margin] duration-300 flex flex-col min-w-0 ${
          isSidebarCollapsed ? 'lg:ml-[80px]' : 'lg:ml-[280px]'
        }`}
      >
        <Header
          onOpenMobileNav={() => setMobileNavOpen(true)}
          user={user}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
        />

        {/* Dynamic View Viewport Stage */}
        <main id="main-content" className="flex-1 min-w-0">
          <Suspense
            fallback={
              <div className="p-8 text-[13px] text-muted" role="status" aria-live="polite">
                Loading…
              </div>
            }
          >
            {currentTab !== 'tools' && <ReportingDashboardView tab={currentTab} themeMode={themeMode} />}

            {currentTab === 'tools' && <ToolsView hiddenSubTabs={navHidden.subTabs} isAdmin={isAdmin} />}
          </Suspense>
        </main>
      </div>

      {navModalOpen && isAdmin && (
        <NavSettingsModal
          hidden={navHidden}
          saving={navSaving}
          error={navError}
          onChange={handleNavChange}
          onClose={() => {
            setNavModalOpen(false);
            setNavError(null);
          }}
        />
      )}
    </div>
  );
}

// Auth gate — wraps the app above without touching anything inside it.
// Unauthenticated renders LoginView; authenticated renders DashboardsApp with
// the real signed-in user.
export default function App() {
  const [user, setUser] = useState<AuthUser | null | 'loading'>('loading');
  // Up here rather than in DashboardsApp so the login screen is themed too.
  const theme = useThemeMode();

  useEffect(() => {
    fetchCurrentUser().then(setUser);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
    }
    setUser(null);
  };

  if (user === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-ink text-white">Loading…</div>;
  }

  if (user === null) {
    return <LoginView onSignedIn={setUser} />;
  }

  return <DashboardsApp user={user} onLogout={handleLogout} themeMode={theme.mode} onThemeChange={theme.setMode} />;
}
