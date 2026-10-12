import { apiFetch } from './api';

// GET /api/status — what the server currently holds from AroFlo.
export interface AroFloStatus {
  // `error`: the last load failed. `warning`: it loaded, but not all of it.
  zones: Record<
    string,
    { lastFetchedAt: string | null; count: number; error: string | null; warning?: string | null; isRefreshing: boolean }
  >;
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
