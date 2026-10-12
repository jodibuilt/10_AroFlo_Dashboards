import { apiFetch } from './api';
import { OverdueAgeingResponse } from '../reporting/types';

export async function fetchOverdueAgeing(view: string): Promise<OverdueAgeingResponse> {
  const params = new URLSearchParams({ view });
  return apiFetch<OverdueAgeingResponse>(`/api/reporting/overdue-ageing?${params.toString()}`);
}
