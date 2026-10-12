import { apiFetch, AuthError } from './api';
import { AuthUser } from '../types';

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await apiFetch<AuthUser>('/auth/me');
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || 'Sign in failed.');
  }
  return body as AuthUser;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
}
