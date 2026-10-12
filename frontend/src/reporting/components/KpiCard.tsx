import React from 'react';
import { Palette } from '../theme';

export type KpiLevel = 'good' | 'warning' | 'critical' | 'neutral';

const PILL_BG: Record<KpiLevel, string> = {
  good: 'rgba(5,150,105,0.14)',
  warning: 'rgba(217,119,6,0.18)',
  critical: 'rgba(220,38,38,0.14)',
  neutral: '', // filled from palette.borderHairlineRgba by the caller via style
};

interface KpiCardProps {
  label: string;
  value: string;
  pillText?: string | null;
  level: KpiLevel;
  palette: Palette;
}

// Ported from aroflo_dash's app.py _kpi_card_html — exact label/value/pill
// sizing and the good/warning/critical/neutral pill color rules.
export const KpiCard: React.FC<KpiCardProps> = ({ label, value, pillText, level, palette }) => {
  const pillTextColor =
    level === 'good' ? palette.statusGood
    : level === 'warning' ? palette.statusWarningText
    : level === 'critical' ? palette.statusCritical
    : palette.inkSecondary;
  const pillBg = level === 'neutral' ? palette.borderHairlineRgba : PILL_BG[level];

  return (
    <div
      className="rounded-md p-4"
      style={{ background: palette.surface, border: `1px solid ${palette.border}`, minHeight: 96 }}
    >
      <div
        className="uppercase"
        style={{ fontSize: '0.78rem', letterSpacing: '0.04em', color: palette.inkMuted }}
      >
        {label}
      </div>
      <div className="mt-1" style={{ fontSize: '1.7rem', fontWeight: 650, color: palette.inkPrimary }}>
        {value}
      </div>
      {pillText && (
        <span
          className="inline-block mt-1 rounded-full"
          style={{ padding: '0.12rem 0.55rem', fontSize: '0.75rem', fontWeight: 600, background: pillBg, color: pillTextColor }}
        >
          {pillText}
        </span>
      )}
    </div>
  );
};

// Ported from aroflo_dash's _rate_level — generic threshold classifier.
export function rateLevel(value: number, good: number, warning: number, higherIsBetter: boolean): KpiLevel {
  if (higherIsBetter) {
    if (value >= good) return 'good';
    if (value >= warning) return 'warning';
    return 'critical';
  }
  if (value <= good) return 'good';
  if (value <= warning) return 'warning';
  return 'critical';
}
