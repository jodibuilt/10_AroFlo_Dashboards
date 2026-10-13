export type PCode = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'PM';

export interface ReportTask {
  taskId: string;
  client: string;
  status: string;
  priority: PCode | null;
  requestDate: string | null;
  completedDate: string | null;
}

export interface KpiSummary {
  issued: number;
  completed: number;
  // Requested in the date range and not finished.
  outstanding: number;
  overdue: number;
  completionRate: number;
  // Overdue ÷ completed. Passes 100% while few of the period's jobs are done.
  overdueRate: number;
  // Overdue ÷ issued.
  overdueRateOfIssued?: number;
  // Every loaded work order for the clients that isn't finished, whatever
  // period it was requested in — "outstanding in the system".
  openInSystem?: number;
}

// One priority level's compliance. Its work orders are of three kinds —
// on time, late, and still in progress (open and not yet due) — and the
// percentage is on time ÷ (on time + late). With nothing decided yet there
// is no percentage: the level is all in progress.
export interface ComplianceRow {
  priority: string;
  total: number;
  onTime?: number;
  late?: number;
  inProgress?: number;
  actualPercent: number | null;
  targetPercent: number;
  variancePp: number | null;
  status: 'Met' | 'Below Target' | 'In progress';
}

export interface BreakdownRow {
  taskId: string;
  jobNumber: string;
  client: string;
  // The level the row is grouped under ("P4") …
  priority: string;
  // … and the priority as AroFlo names it ("AP5").
  priorityName?: string;
  requestDate: string | null;
  actualStartDate: string | null;
  requiredCompletedDate: string | null;
  completedDate: string | null;
  daysLate: number | null;
  delayReason: string;
  currentSubstatus: string;
}

export interface ReportingKpisResponse {
  summary: KpiSummary;
  priorityCompliance: ComplianceRow[];
  breakdown: BreakdownRow[];
  pmBreakdown: BreakdownRow[];
  tasks: ReportTask[];
  meta: {
    lastFetchedAt: string | null;
    error: string | null;
    priorityCodeMapConfigured: boolean;
    // { P4: 'P4/P5' } when the P4 group holds level-5 (AP5) jobs.
    levelLabels?: Record<string, string>;
  };
}

export interface ReportingConfig {
  priorityCodeMap: Record<string, string>;
  priorityTargets: Record<string, number>;
  targetClients: Record<string, string>;
  reportTitle: string;
  reportSubtitle: string;
  // The zone "today" and the times on the pages are in (./time).
  timeZone?: string;
}

export type ColorOverrides = Record<string, string>;

export interface OverdueBucket {
  key: string;
  label: string;
  count: number;
}

export interface OverduePriorityRow {
  priority: string;
  total: number;
  [bucketKey: string]: number | string;
}

export interface OverdueJobRow {
  taskId: string;
  jobNumber: string;
  taskName: string;
  client: string;
  // `priority` is what the section groups and filters by: the P-scale level
  // where the priority has one. `priorityName` is AroFlo's own name for it.
  priority: string;
  priorityName?: string;
  site: string;
  dueDate: string | null;
  daysOverdue: number | null;
  status: string;
}

export interface InvoiceKpis {
  submittedCount: number;
  submittedTotalInc: number;
  submittedTotalEx: number;
  // The part of submitted whose status is In Progress: gone to the client,
  // and said to be in progress wherever submitted is shown.
  inProgressCount?: number;
  inProgressTotalInc?: number;
  paidCount: number;
  paidTotalInc: number;
  unpaidCount: number;
  unpaidTotalInc: number;
}

export interface InvoiceByClientRow {
  client: string;
  submittedCount: number;
  totalInc: number;
  totalEx: number;
  paidCount: number;
  paidValue: number;
  unpaidCount: number;
  unpaidValue: number;
}

export interface InvoiceByStatusRow {
  status: string;
  client: string;
  count: number;
  totalInc: number;
  totalEx: number;
}

export interface InvoiceListRow {
  invoiceNumber: string;
  client: string;
  clientBucket: string;
  status: string;
  dateInvoiced: string | null;
  dueDate: string | null;
  totalInc: number | null;
  totalEx: number | null;
  paid: 'Yes' | 'No';
}

export interface InvoicingReportResponse {
  data: {
    kpis: InvoiceKpis;
    byClient: InvoiceByClientRow[];
    byStatus: InvoiceByStatusRow[];
    invoiceList: InvoiceListRow[];
    buckets: string[];
  };
  meta: {
    lastFetchedAt: string | null;
    error: string | null;
    paymentsError: string | null;
    // Payments loaded, but not all of them — and why.
    paymentsWarning?: string | null;
    paymentsLastFetchedAt: string | null;
    paymentsRecordCount: number;
    paymentsCoverFullRange: boolean;
    view: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export interface OverdueAgeingResponse {
  data: {
    total: number;
    oldestDays: number | null;
    buckets: OverdueBucket[];
    byPriority: OverduePriorityRow[];
    byClient: { client: string; total: number }[];
    bySite: { site: string; total: number }[];
    rows: OverdueJobRow[];
  };
  meta: { lastFetchedAt: string | null; error: string | null; today: string; view: string; levelLabels?: Record<string, string> };
}
