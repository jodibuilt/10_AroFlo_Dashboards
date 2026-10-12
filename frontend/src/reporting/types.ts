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
  overdueRate: number;
  // Every loaded work order for the clients that isn't finished, whatever
  // period it was requested in — "outstanding in the system".
  openInSystem?: number;
}

export interface ComplianceRow {
  priority: string;
  total: number;
  actualPercent: number;
  targetPercent: number;
  variancePp: number;
  status: 'Met' | 'Below Target';
}

export interface BreakdownRow {
  taskId: string;
  jobNumber: string;
  client: string;
  priority: string;
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
  meta: { lastFetchedAt: string | null; error: string | null; priorityCodeMapConfigured: boolean };
}

export interface ReportingConfig {
  priorityCodeMap: Record<string, string>;
  priorityTargets: Record<string, number>;
  targetClients: Record<string, string>;
  reportTitle: string;
  reportSubtitle: string;
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
  meta: { lastFetchedAt: string | null; error: string | null; today: string; view: string };
}
