import { apiFetch } from './api';
import { BusinessUnitSplit } from './reportingRefresh';

// GET /api/workload?day=YYYY-MM-DD — the jobs scheduled to each field worker
// on a day and which are done, and each worker's jobs not done yet from that
// day back (src/workload/ on the server). Reading it never touches AroFlo;
// only startWorkloadUpdate does.

// One worker. Scheduled that day: booked = done + open. Not done yet:
// notDone = notDoneOnDay + notDoneEarlier.
export interface WorkloadWorker {
  worker: string;
  booked: number;
  done: number;
  open: number;
  // Hours booked on the calendar that day.
  hours: number;
  notDone: number;
  // Of those: on the day's own calendar, or only on earlier days'.
  notDoneOnDay: number;
  notDoneEarlier: number;
  // Carried over from an earlier day's calendar and finished on the day.
  finishedFromEarlier: number;
  // The first day the longest-waiting of their not-done jobs was scheduled to them (YYYY-MM-DD), or ''.
  oldest: string;
  // Everything they finished on the day: done from the day's calendar, and finished from earlier days.
  finishedInAll: number;
}

// One job on one worker's calendar that day. Dates and times are AroFlo's
// own wall-clock strings ("2026/10/14 07:30:00").
export interface WorkloadJob {
  worker: string;
  jobNumber: string;
  // The customer's order number (AroFlo's custon): what the page shows as the job.
  customerOrderNumber: string;
  taskName: string;
  client: string;
  site: string;
  priority: string;
  // As AroFlo has them now.
  status: string;
  substatus: string;
  start: string;
  end: string;
  hours: number;
  // "completed" means done as of this day — a job finished the day after
  // stays "ongoing" here.
  state: 'completed' | 'ongoing';
  // How it is done: finished that day, finished on an earlier day, or with
  // the office to be invoiced ("Ready for Invoicing").
  doneHow: '' | 'completed' | 'earlier' | 'invoicing';
  completedAt: string;
}

// One job not done yet (or carried over and finished on the day), on the
// list of whoever it was most recently scheduled to.
export interface WorkloadBacklogJob {
  worker: string;
  jobNumber: string;
  // The customer's order number (AroFlo's custon): what the page shows as the job.
  customerOrderNumber: string;
  taskName: string;
  client: string;
  site: string;
  priority: string;
  status: string;
  substatus: string;
  // The days it was on this worker's calendar (YYYY-MM-DD), oldest first.
  scheduledDays: string[];
  firstScheduled: string;
  lastScheduled: string;
  // On the day's own calendar.
  onDay: boolean;
  // Days from the first time it was scheduled to them to the day.
  daysWaiting: number;
  state: 'open' | 'finished';
  completedAt: string;
  // Never read from AroFlo yet: shown by name only.
  unread: boolean;
}

// On the calendar that day but not counted, and why: leave, equipment, a
// hidden booking on a job that isn't finished (a follow-up, not a job).
export interface WorkloadNotCounted {
  worker: string;
  jobNumber: string;
  // The customer's order number (AroFlo's custon): what the page shows as the job.
  customerOrderNumber: string;
  taskName: string;
  start: string;
  end: string;
  reason: string;
}

// A job finished on the day that was on nobody's calendar in all the days looked at.
export interface WorkloadUnbooked {
  jobNumber: string;
  // The customer's order number (AroFlo's custon): what the page shows as the job.
  customerOrderNumber: string;
  taskName: string;
  client: string;
  site: string;
  priority: string;
  status: string;
  substatus: string;
  completedAt: string;
  // Who marked it done, when AroFlo's message said.
  completedBy: string;
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
    backlog: {
      // The first day looked back to (YYYY-MM-DD), how many days that is, and how many of them have a calendar on record.
      from: string;
      days: number;
      calendarsKept: number;
      jobs: WorkloadBacklogJob[];
    };
    notBooked: WorkloadUnbooked[];
    notCounted: WorkloadNotCounted[];
    totals: {
      workers: number;
      booked: number;
      done: number;
      open: number;
      notDone: number;
      notDoneOnDay: number;
      notDoneEarlier: number;
      finishedFromEarlier: number;
      finishedInAll: number;
      finishedNotBooked: number;
      notCounted: number;
    };
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
    // Today is read from AroFlo by itself this often, in minutes; 0 = never.
    autoUpdateMinutes: number;
  };
}

export async function fetchWorkload(day: string): Promise<WorkloadResponse> {
  return apiFetch<WorkloadResponse>(`/api/workload?day=${encodeURIComponent(day)}`);
}

// Asks the server to read the day from AroFlo. It answers at once and works
// in the background — poll fetchWorkload and watch meta.updating.
export async function startWorkloadUpdate(day: string): Promise<void> {
  await apiFetch<{ started: boolean }>(`/api/workload/update?day=${encodeURIComponent(day)}`, { method: 'POST' });
}
