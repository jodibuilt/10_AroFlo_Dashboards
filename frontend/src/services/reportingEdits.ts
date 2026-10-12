import { apiFetch } from './api';

export interface EditScope {
  view: string;
  dateFrom: string;
  dateTo: string;
}

function query(scope: EditScope): string {
  return new URLSearchParams({ view: scope.view, dateFrom: scope.dateFrom, dateTo: scope.dateTo }).toString();
}

export async function loadDashboardEdit<T>(stateKey: string, scope: EditScope): Promise<T | null> {
  const { payload } = await apiFetch<{ payload: T | null }>(`/api/dashboard-edits/${encodeURIComponent(stateKey)}?${query(scope)}`);
  return payload;
}

export async function saveDashboardEdit<T>(stateKey: string, scope: EditScope, payload: T): Promise<void> {
  await apiFetch(`/api/dashboard-edits/${encodeURIComponent(stateKey)}?${query(scope)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteDashboardEdit(stateKey: string, scope: EditScope): Promise<void> {
  await apiFetch(`/api/dashboard-edits/${encodeURIComponent(stateKey)}?${query(scope)}`, { method: 'DELETE' });
}
