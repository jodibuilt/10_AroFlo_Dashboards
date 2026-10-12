import { apiFetch } from './api';
import { InvoicingReportResponse } from '../reporting/types';

export async function fetchInvoicingReport(
  view: string,
  dateFrom: string,
  dateTo: string,
): Promise<InvoicingReportResponse> {
  const params = new URLSearchParams({ view, dateFrom, dateTo });
  return apiFetch<InvoicingReportResponse>(`/api/reporting/invoicing?${params.toString()}`);
}
