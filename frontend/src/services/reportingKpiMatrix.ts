import { apiFetch } from './api';
import { CsvRow } from '../lib/csv';

// One work order as GET /api/reporting/kpi-matrix returns it. Date-times are
// AroFlo's own local-time strings — "YYYY/MM/DD HH:mm:ss", or just the date.
interface LiveKpiTask {
  jobNumber: string;
  taskName: string;
  client: string;
  status: string;
  substatus: string;
  priority: string;
  requestedAt: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  description: string;
}

interface LiveKpiTasksResponse {
  data: LiveKpiTask[];
  meta: { lastFetchedAt: string | null; error: string | null };
}

// Live work orders in the shape the KPI Compliance Matrix already reads: rows
// keyed by the AroFlo task export's column names, so they go through exactly
// the pipeline an uploaded CSV does (reporting/kpiMatrix/ingest.ts).
export interface LiveKpiRows {
  headers: string[];
  rows: CsvRow[];
  // When the server last pulled these from AroFlo, and why that pull failed
  // if it did (the rows are then whatever loaded before).
  lastFetchedAt: string | null;
  error: string | null;
}

// Not a column of the export — the matrix only uses it for its client filter.
export const LIVE_CLIENT_COLUMN = 'Client';

const LIVE_HEADERS = [
  'Jobnumber',
  'Task',
  'Status',
  'Substatus',
  'Priority',
  'Requested Date',
  'Requested Time',
  'Task Due Date',
  'Task Due Time',
  'Schedule Start Date',
  'Schedule Start Time',
  'Completed Date',
  'Completed Time',
  'Description',
  LIVE_CLIENT_COLUMN,
];

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function splitDateTime(value: string | null): [string, string] {
  const [date = '', time = ''] = str(value).trim().split(/[ T]/);
  return [date, time];
}

function toExportRow(t: LiveKpiTask): CsvRow {
  const [requestedDate, requestedTime] = splitDateTime(t.requestedAt);
  const [dueDate] = splitDateTime(t.dueAt);
  const [startDate, startTime] = splitDateTime(t.startedAt);
  const [completedDate, completedTime] = splitDateTime(t.completedAt);
  return {
    Jobnumber: str(t.jobNumber),
    Task: str(t.taskName),
    Status: str(t.status),
    Substatus: str(t.substatus),
    Priority: str(t.priority),
    'Requested Date': requestedDate,
    'Requested Time': requestedTime,
    'Task Due Date': dueDate,
    // Due by the end of the due day, whatever time AroFlo holds against it:
    // the Work Orders report compares days (src/kpi.js), the contract's
    // windows are in calendar days, and a job the one page calls on time
    // must not be late on the other. (A due date with no time is stored as
    // midnight at the START of the day — read literally, a job finished
    // during its due day would be late.)
    'Task Due Time': dueDate ? '23:59:59' : '',
    // Stands in for the export's Schedule Start: the first labour entry
    // logged on the job. A task carries no schedule of its own in the API.
    'Schedule Start Date': startDate,
    'Schedule Start Time': startTime,
    'Completed Date': completedDate,
    'Completed Time': completedTime,
    Description: str(t.description),
    [LIVE_CLIENT_COLUMN]: str(t.client),
  };
}

export async function fetchLiveKpiRows(): Promise<LiveKpiRows> {
  const res = await apiFetch<LiveKpiTasksResponse>('/api/reporting/kpi-matrix');
  return {
    headers: LIVE_HEADERS,
    rows: res.data.map(toExportRow),
    lastFetchedAt: res.meta.lastFetchedAt,
    error: res.meta.error,
  };
}
