import { apiFetch } from './api';

export async function fetchReportingClients(): Promise<string[]> {
  const { data } = await apiFetch<{ data: string[] }>('/api/reporting/clients');
  return data;
}
