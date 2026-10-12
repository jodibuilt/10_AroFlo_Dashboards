import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Sidebar, NAV_CATEGORIES } from './components/Sidebar';
import { Header } from './components/Header';
import { NavSettingsModal } from './components/NavSettingsModal';
import { LoginView } from './views/LoginView';
import { NavHidden, NAV_HIDDEN_EMPTY } from './nav';
import { fetchNavHidden, updateNavHidden } from './services/navConfig';
import { AuthError } from './services/api';
import { fetchCurrentUser, logout } from './services/auth';
import { NavigationTab, AuthUser } from './types';

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
const VALID_TABS: NavigationTab[] = ['reports', 'tools'];
const DEFAULT_TAB: NavigationTab = 'reports';

function DashboardsApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const resolveInitialTab = (): NavigationTab => {
    const param = new URLSearchParams(window.location.search).get('tab');
    return param && VALID_TABS.includes(param as NavigationTab) ? (param as NavigationTab) : DEFAULT_TAB;
  };
  const [currentTab, setCurrentTab] = useState<NavigationTab>(resolveInitialTab());

  // Keep the URL's ?tab= in sync so a refresh (or bookmark/share) lands back
  // on the same page instead of always resetting to Reports — replaceState,
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
    fetchNavHidden().then(setNavHidden).catch(() => {});
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
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} user={user} />

        {/* Dynamic View Viewport Stage */}
        <main id="main-content" className="flex-1 min-w-0">
          <Suspense
            fallback={
              <div className="p-8 text-[13px] text-muted" role="status" aria-live="polite">
                Loading…
              </div>
            }
          >
            {currentTab === 'reports' && (
              <ReportingDashboardView hiddenSubTabs={navHidden.subTabs} isAdmin={isAdmin} />
            )}

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

  return <DashboardsApp user={user} onLogout={handleLogout} />;
}
