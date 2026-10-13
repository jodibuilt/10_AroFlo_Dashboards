import React from 'react';
import { Palette } from '../theme';
import { dayOf, today, zonedNow } from '../time';

// Every date here is a day in the reports' time zone (Adelaide — see
// ../time), as a date input holds it: YYYY-MM-DD.
export function firstOfThisMonth(): string {
  const d = zonedNow();
  return dayOf(new Date(d.getFullYear(), d.getMonth(), 1));
}

interface Preset {
  label: string;
  from: string;
  to: string;
}

// One per month the loaded data reaches back to, then the whole lot. The
// current month runs to today; earlier ones are whole months.
function presets(coverageFrom: string | null): Preset[] {
  const now = zonedNow();
  const first = coverageFrom ? new Date(coverageFrom.replace(/\//g, '-') + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = isNaN(first.getTime()) ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : first;
  const out: Preset[] = [];
  for (let m = new Date(start.getFullYear(), start.getMonth(), 1); m <= now; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const thisMonth = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();
    out.push({
      label: thisMonth ? 'This month' : m.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      from: dayOf(m),
      to: thisMonth ? today() : dayOf(new Date(m.getFullYear(), m.getMonth() + 1, 0)),
    });
  }
  if (coverageFrom && out.length > 1) out.push({ label: 'Everything loaded', from: dayOf(start), to: today() });
  return out;
}

interface Props {
  palette: Palette;
  from: string;
  to: string;
  // The first day the loaded data covers (YYYY/MM/DD), if known.
  coverageFrom: string | null;
  onPick: (from: string, to: string) => void;
}

// The date ranges people actually ask for — a month at a time — one click
// each, instead of two date pickers. The one in use is filled in.
export const DatePresets: React.FC<Props> = ({ palette, from, to, coverageFrom, onPick }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: palette.inkSecondary }}>
    <span>Quick range</span>
    {presets(coverageFrom).map((p) => {
      const on = p.from === from && p.to === to;
      return (
        <button
          key={p.label}
          type="button"
          aria-pressed={on}
          onClick={() => onPick(p.from, p.to)}
          className="px-2.5 py-1 rounded-md text-[12px] font-semibold"
          style={{
            background: on ? palette.accentBlue : palette.surface,
            color: on ? '#fff' : palette.inkPrimary,
            border: `1px solid ${on ? palette.accentBlue : palette.border}`,
          }}
        >
          {p.label}
        </button>
      );
    })}
  </div>
);
