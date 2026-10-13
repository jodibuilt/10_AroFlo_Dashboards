import React from 'react';
import { Palette } from '../theme';

// How "late" is decided, said out loud next to the numbers rather than
// folded away with the other definitions — because it is a choice, and one
// for the people the report is for to confirm. Work Orders and the KPI
// Matrix both use this rule (src/kpi.js; kpiMatrix/ingest.ts), and both
// show this same note, so there is one wording to agree or change.
export const LateRuleNote: React.FC<{ palette: Palette }> = ({ palette }) => (
  <div
    role="note"
    className="rounded-md px-4 py-3 text-[12px]"
    style={{
      background: palette.surface,
      border: `1px solid ${palette.border}`,
      borderLeft: `4px solid ${palette.statusWarning}`,
      color: palette.inkSecondary,
    }}
  >
    <div className="text-[13px] font-semibold" style={{ color: palette.inkPrimary }}>
      How “late” is counted — an assumption to confirm
    </div>
    <p className="mt-1">
      A work order counts as late when it was <b>finished after its due date</b>, or is <b>still open past its due date</b>.
      Work Orders (Overdue, Days Late, Target KPI Compliance) and the KPI Matrix (Late on each Completed row) both use
      this rule, so their late counts agree.
    </p>
    <p className="mt-1">Two points to confirm with the people this report is for:</p>
    <ol className="list-decimal ml-5 mt-1 space-y-0.5">
      <li>
        Should a job that is <b>still open past its due date</b> count as late now, as it does here — or only once it has
        been finished?
      </li>
      <li>
        Lateness is judged <b>by day</b>: a job finished at any time on its due date is on time, even where AroFlo holds a
        time of day against the due date. Should the time of day count?
      </li>
    </ol>
  </div>
);
