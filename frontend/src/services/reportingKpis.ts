import { apiFetch } from './api';
import { ReportingKpisResponse } from '../reporting/types';

export async function fetchReportingKpis(dateFrom: string, dateTo: string, view: string): Promise<ReportingKpisResponse> {
  const params = new URLSearchParams({ dateFrom, dateTo, view });
  return apiFetch<ReportingKpisResponse>(`/api/reporting/kpis?${params.toString()}`);
}
