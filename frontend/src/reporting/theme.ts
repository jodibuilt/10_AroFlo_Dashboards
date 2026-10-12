// Ported verbatim from aroflo_dash's theme.py — exact hex values, both
// palettes. See cosmic-tumbling-pearl.md for the research pass this came
// from. Used only by the Reporting Dashboard page (frontend/src/reporting/*),
// applied via inline styles / the `dash-dark:` Tailwind variant, never
// global — see index.css's `@custom-variant dash-dark`.
export interface Palette {
  surface: string;
  pagePlane: string;
  inkPrimary: string;
  inkSecondary: string;
  inkMuted: string;
  border: string;
  borderHairlineRgba: string;
  accentBlue: string;
  statusGood: string;
  statusWarning: string;
  statusSerious: string;
  statusCritical: string;
  statusWarningText: string;
  statusSeriousText: string;
  catBlue: string;
  catAqua: string;
  catYellow: string;
  catGreen: string;
  catViolet: string;
  catRed: string;
  catMagenta: string;
  catOrange: string;
  priorityColors: Record<string, string>;
}

export const FONT_FAMILY = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

// Enterprise design system — industrial terracotta on a slate canvas (light),
// zinc chrome (dark). `accentBlue` keeps its name for API stability but is now
// the terracotta brand accent; `catBlue` stays sky-blue for chart series.
export const LIGHT: Palette = {
  surface: '#ffffff',
  pagePlane: '#f8fafc',
  inkPrimary: '#18181b',
  inkSecondary: '#475569',
  inkMuted: '#94a3b8',
  border: '#e2e8f0',
  borderHairlineRgba: 'rgba(15,23,42,0.08)',
  accentBlue: '#c85a24',
  statusGood: '#059669',
  statusWarning: '#d97706',
  statusSerious: '#ea580c',
  statusCritical: '#dc2626',
  statusWarningText: '#b45309',
  statusSeriousText: '#c2410c',
  catBlue: '#0284c7',
  catAqua: '#0d9488',
  catYellow: '#d97706',
  catGreen: '#059669',
  catViolet: '#7c3aed',
  catRed: '#dc2626',
  catMagenta: '#db2777',
  catOrange: '#c85a24',
  priorityColors: { P1: '#0c4a6e', P2: '#0369a1', P3: '#0284c7', P4: '#0ea5e9', P5: '#38bdf8', PM: '#7dd3fc' },
};

export const DARK: Palette = {
  surface: '#27272a',
  pagePlane: '#18181b',
  inkPrimary: '#fafafa',
  inkSecondary: '#d4d4d8',
  inkMuted: '#a1a1aa',
  border: '#3f3f46',
  borderHairlineRgba: 'rgba(255,255,255,0.10)',
  accentBlue: '#e07a45',
  statusGood: '#10b981',
  statusWarning: '#f59e0b',
  statusSerious: '#fb923c',
  statusCritical: '#ef4444',
  statusWarningText: '#fbbf24',
  statusSeriousText: '#fdba74',
  catBlue: '#38bdf8',
  catAqua: '#2dd4bf',
  catYellow: '#fbbf24',
  catGreen: '#10b981',
  catViolet: '#a78bfa',
  catRed: '#f87171',
  catMagenta: '#f472b6',
  catOrange: '#e07a45',
  priorityColors: { P1: '#7dd3fc', P2: '#38bdf8', P3: '#0ea5e9', P4: '#0284c7', P5: '#0369a1', PM: '#0c4a6e' },
};

export type ThemeMode = 'light' | 'dark' | 'system';

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function getPalette(mode: ThemeMode): Palette {
  return resolveIsDark(mode) ? DARK : LIGHT;
}

export function statusColors(p: Palette): Record<string, string> {
  return {
    Completed: p.catAqua,
    'In Progress': p.catBlue,
    Scheduled: p.catViolet,
    'On Hold': p.catYellow,
    'Awaiting Approval': p.catOrange,
  };
}

export function clientColors(p: Palette): Record<string, string> {
  return { Ventia: p.catBlue, SAHA: p.catAqua };
}

// [cat_blue, cat_aqua, cat_yellow, cat_green, cat_violet, cat_red, cat_magenta, cat_orange]
export function fallbackColorCycle(p: Palette): string[] {
  return [p.catBlue, p.catAqua, p.catYellow, p.catGreen, p.catViolet, p.catRed, p.catMagenta, p.catOrange];
}

export function kpiTargetDefaultColors(p: Palette): Record<string, string> {
  return { 'Met Target': p.statusGood, 'Below Target': p.statusCritical, Target: p.inkPrimary };
}

export const PRIORITY_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5', 'PM'];
export const BREAKDOWN_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const PM_PRIORITIES = ['P5', 'PM'];
export const COMPLETED_STATUSES = new Set(['Completed', 'Archived']);
