import { apiFetch } from './api';
import { NavHidden } from '../nav';

export async function fetchNavHidden(): Promise<NavHidden> {
  return apiFetch<NavHidden>('/api/settings/nav');
}

// Admin-only server-side (403 otherwise). Returns the persisted value.
export async function updateNavHidden(next: NavHidden): Promise<NavHidden> {
  return apiFetch<NavHidden>('/api/settings/nav', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
}
