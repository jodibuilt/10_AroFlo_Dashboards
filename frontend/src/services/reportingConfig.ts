import { apiFetch } from './api';
import { ReportingConfig } from '../reporting/types';

export async function fetchReportingConfig(): Promise<ReportingConfig> {
  return apiFetch<ReportingConfig>('/api/reporting/config');
}
