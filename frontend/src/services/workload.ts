import { apiFetch } from './api';
import { BusinessUnitSplit } from './reportingRefresh';

// GET /api/workload?day=YYYY-MM-DD — the jobs booked to each field worker on
// a day, and how many are done (src/workload/ on the server). Reading it
// never touches AroFlo; only startWorkloadUpdate does.

// One worker's day.
export interface WorkloadWorker {
  worker: string;
  booked: number;
  completed: number;
  // Booked for the day and not finished on it.
  ongoing: number;
  hours: number;
}

// One job on one worker's list. Dates and times are AroFlo's own wall-clock
// strings ("2026/10/14 07:30:00").
export interface WorkloadJob {
  worker: string;
  jobNumber: string;
  taskName: string;
  client: string;
  site: string;
  priority: string;
  status: string;
  start: string;
  end: string;
  hours: number;
  // "completed" means finished ON this day — a job finished the day after
  // stays "ongoing" here and is counted there.
  state: 'completed' | 'ongoing';
  completedAt: string;
}

// A job finished on the day without being booked on it.
export interface WorkloadUnbooked {
  jobNumber: string;
  taskName: string;
  client: string;
  site: string;
  priority: string;
  status: string;
  completedAt: string;
  // Who marked it done, when AroFlo's message said.
  completedBy: string;
  // Who had it on the most recent earlier day it was booked, if known.
  lastBookedTo: string;
}

export interface WorkloadResponse {
  data: {
    day: string;
    // Today in the reports' time zone.
    today: string;
    when: 'past' | 'today' | 'future';
    // False until someone has pressed "Update now" for this day.
    loaded: boolean;
    workers: WorkloadWorker[];
    jobs: WorkloadJob[];
    notBooked: WorkloadUnbooked[];
    totals: { workers: number; booked: number; completed: number; ongoing: number; completedNotBooked: number };
  };
  meta: {
    // When the bookings were last read from AroFlo (an ISO instant).
    fetchedAt: string | null;
    requests: number;
    notes: string[];
    businessUnits: BusinessUnitSplit | null;
    // AroFlo said its calendar changed after the bookings were read.
    calendarChangedAt: string | null;
    updating: boolean;
    error: string | null;
    // AroFlo is set up to push changes here as they happen.
    pushEnabled: boolean;
  };
}

export async function fetchWorkload(day: string): Promise<WorkloadResponse> {
  return apiFetch<WorkloadResponse>(`/api/workload?day=${encodeURIComponent(day)}`);
}

// Asks the server to read the day from AroFlo (two or three requests). It
// answers at once and works in the background — poll fetchWorkload and watch
// meta.updating.
export async function startWorkloadUpdate(day: string): Promise<void> {
  await apiFetch<{ started: boolean }>(`/api/workload/update?day=${encodeURIComponent(day)}`, { method: 'POST' });
}
