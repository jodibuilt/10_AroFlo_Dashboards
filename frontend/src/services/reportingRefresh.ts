import { apiFetch } from './api';

// Whose records a zone was sent, and how many were kept: the server drops
// work orders and invoices that belong to a business unit the reports are
// not for (src/businessUnit.js). `count` on the zone is what was kept.
export interface BusinessUnitSplit {
  reportsAreFor: string[];
  // By the business unit's name in AroFlo.
  received: Record<string, number>;
  kept: number;
  leftOut: number;
  // False when the zone could not be limited (AroFlo named no owner) or is not meant to be.
  limited: boolean;
}

// GET /api/status — what the server currently holds from AroFlo.
export interface AroFloStatus {
  // `error`: the last load failed. `warning`: it loaded, but not all of it.
  zones: Record<
    string,
    {
      lastFetchedAt: string | null;
      count: number;
      error: string | null;
      warning?: string | null;
      businessUnits?: BusinessUnitSplit | null;
      isRefreshing: boolean;
    }
  >;
  // The business units the reports are for; "*" is all of them.
  businessUnits?: string[];
  // When the refresh now running (or the last one) began. A zone fetched
  // since then has been loaded by it.
  refreshStartedAt?: string | null;
  // Null until the first refresh since the server started.
  lastRefreshCompletedAt: string | null;
  // The first day the loaded data covers, YYYY/MM/DD. Work orders requested
  // (and invoices raised) before it are not in any report.
  coverageFrom?: string | null;
  // How many months before the current one the app loads (REPORT_LOOKBACK_MONTHS).
  lookbackMonths?: number;
  isRefreshingAll: boolean;
}

// "2026/08/01" -> "1 Aug 2026".
export function formatCoverage(coverageFrom: string): string {
  const [y, m, d] = coverageFrom.split('/').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export async function fetchAroFloStatus(): Promise<AroFloStatus> {
  return apiFetch<AroFloStatus>('/api/status');
}

// Asks the server to re-read everything from AroFlo. It answers straight
// away and does the work in the background — poll fetchAroFloStatus to see
// it finish. This is the only thing that makes the app call AroFlo.
export async function startAroFloRefresh(): Promise<void> {
  await apiFetch<{ started: boolean }>('/api/refresh', { method: 'POST' });
}
