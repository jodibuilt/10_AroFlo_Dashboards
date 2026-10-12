import React, { useEffect, useState } from 'react';
import { getPalette, resolveIsDark, ThemeMode } from './theme';
import { ReportingConfig } from './types';
import { fetchReportingConfig } from '../services/reportingConfig';
import { KpiMatrixSection } from './kpiMatrix/KpiMatrixSection';
import { AnalyticsTab } from './AnalyticsTab';
import { InvoicingTab } from './invoicing/InvoicingTab';

type SubTab = 'matrix' | 'analytics' | 'invoicing';

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const SUB_TABS: { id: SubTab; label: string; subtitle: string }[] = [
  { id: 'matrix', label: 'KPI Matrix', subtitle: 'Client SLA compliance template — live from the AroFlo API, or an uploaded task export (CSV)' },
  { id: 'analytics', label: 'Work Orders', subtitle: 'Live work-order analytics from the AroFlo API' },
  { id: 'invoicing', label: 'Invoicing', subtitle: 'Invoiced / paid / outstanding by client, from the AroFlo API' },
];

interface Props {
  hiddenSubTabs?: string[];
  isAdmin?: boolean;
  // Set when the host app picks the pane itself (AroFlo Dashboards lists the
  // panes in its sidebar) — the pane follows this and the in-page switcher
  // isn't rendered.
  tab?: SubTab;
  // Set when the host app owns the light/dark switch (AroFlo Dashboards has
  // one in its header, for the whole app) — the page follows this and its
  // own switch isn't rendered.
  themeMode?: ThemeMode;
}

// Shell for the Reports tab. Owns theme + striped + which sub-tab is active,
// and the report config (for the title). The two panes — the CSV-driven KPI
// Matrix and the live Analytics dashboard — are fully separate below.
export const ReportingDashboardView: React.FC<Props> = ({
  hiddenSubTabs = [],
  isAdmin = false,
  tab,
  themeMode: hostThemeMode,
}) => {
  const [config, setConfig] = useState<ReportingConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [ownThemeMode, setThemeMode] = useState<ThemeMode>(() => loadLocal('reporting-theme', 'system' as ThemeMode));
  const themeMode = hostThemeMode ?? ownThemeMode;
  const [striped, setStriped] = useState(() => loadLocal('reporting-striped', true));
  const [ownSubTab, setSubTab] = useState<SubTab>(() => {
    const saved = loadLocal('reporting-subtab', 'matrix' as SubTab);
    // Guard against a stale id from a previous build (e.g. the retired
    // 'projects-sim') left in localStorage.
    return SUB_TABS.some((t) => t.id === saved) ? saved : 'matrix';
  });
  const subTab = tab ?? ownSubTab;

  const hidden = new Set(hiddenSubTabs);
  const isHidden = (id: SubTab) => hidden.has(`reports:${id}`);
  const visibleSubTabs = isAdmin ? SUB_TABS : SUB_TABS.filter((t) => !isHidden(t.id));

  useEffect(() => {
    if (!isAdmin && isHidden(subTab)) setSubTab(visibleSubTabs[0]?.id ?? 'matrix');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenSubTabs, subTab, isAdmin]);

  const palette = getPalette(themeMode);
  const isDark = resolveIsDark(themeMode);

  useEffect(() => {
    fetchReportingConfig().then(setConfig).catch((e) => setConfigError(e.message));
  }, []);
  useEffect(() => {
    localStorage.setItem('reporting-theme', JSON.stringify(themeMode));
  }, [themeMode]);
  useEffect(() => {
    localStorage.setItem('reporting-striped', JSON.stringify(striped));
  }, [striped]);
  useEffect(() => {
    localStorage.setItem('reporting-subtab', JSON.stringify(subTab));
  }, [subTab]);

  const active = SUB_TABS.find((t) => t.id === subTab) ?? SUB_TABS[0];

  return (
    <div className={isDark ? 'dash-dark' : ''} style={{ background: palette.pagePlane, minHeight: '100%' }}>
      <div className="p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-baseline justify-between gap-3 pb-3" style={{ borderBottom: `1px solid ${palette.border}` }}>
          <div>
            <h1 className="text-[1.6rem] font-bold" style={{ color: palette.inkPrimary }}>
              {config?.reportTitle || 'Reports'}
            </h1>
            <div className="text-[0.95rem]" style={{ color: palette.inkSecondary }}>
              {active.subtitle}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-[12px]" style={{ color: palette.inkSecondary }}>
              <input type="checkbox" checked={striped} onChange={(e) => setStriped(e.target.checked)} />
              Striped table rows
            </label>
            {!hostThemeMode && (
              <div className="flex gap-1 rounded-md p-0.5" style={{ border: `1px solid ${palette.border}` }}>
                {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setThemeMode(m)}
                    className="px-2 py-1 rounded-md text-[11px] font-semibold capitalize"
                    style={{ background: themeMode === m ? palette.border : 'transparent', color: palette.inkPrimary }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sub-tab switcher */}
        {!tab && visibleSubTabs.length > 0 && (
          <div className="inline-flex gap-1 rounded-md p-0.5" style={{ border: `1px solid ${palette.border}`, background: palette.surface }}>
            {visibleSubTabs.map((t) => {
              const th = isHidden(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => setSubTab(t.id)}
                  className="px-4 py-1.5 rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5"
                  style={{
                    background: subTab === t.id ? palette.accentBlue : 'transparent',
                    color: subTab === t.id ? '#fff' : palette.inkPrimary,
                    opacity: th ? 0.5 : 1,
                  }}
                >
                  {t.label}
                  {th && <span className="material-symbols-outlined text-[14px]">visibility_off</span>}
                </button>
              );
            })}
          </div>
        )}

        {configError && (
          <div className="p-3 rounded-md text-[13px]" style={{ background: 'rgba(220,38,38,0.10)', color: palette.statusCritical }}>
            {configError}
          </div>
        )}

        {visibleSubTabs.length === 0 ? (
          <p className="text-[13px]" style={{ color: palette.inkMuted }}>
            Every Reports sub-tab is currently hidden.
          </p>
        ) : (
          <>
            {subTab === 'matrix' && <KpiMatrixSection palette={palette} striped={striped} />}
            {subTab === 'analytics' && <AnalyticsTab palette={palette} striped={striped} config={config} />}
            {subTab === 'invoicing' && <InvoicingTab palette={palette} striped={striped} />}
          </>
        )}
      </div>
    </div>
  );
};
