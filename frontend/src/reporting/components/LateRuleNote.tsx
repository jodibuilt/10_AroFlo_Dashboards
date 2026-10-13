import React from 'react';
import { Palette } from '../theme';

// How "late" is decided, said next to the numbers rather than folded away
// with the other definitions: it is the one rule every figure about lateness
// rests on. Work Orders and the KPI Matrix both use it (src/kpi.js;
// kpiMatrix/ingest.ts) and both show this same line, so there is one wording
// to change. Whether the rule itself is the right one is a question for the
// people the reports are for — it is on the list in the README, not here.
export const LateRuleNote: React.FC<{ palette: Palette }> = ({ palette }) => (
  <p
    role="note"
    className="rounded-md px-4 py-2.5 text-[12px]"
    style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkSecondary }}
  >
    <b style={{ color: palette.inkPrimary }}>How late is counted.</b> A work order is late when it was finished after its
    due date, or is still open past it. Lateness is judged by day: finished at any time on the due date is on time. Work
    Orders and the KPI Matrix use the same rule.
  </p>
);
