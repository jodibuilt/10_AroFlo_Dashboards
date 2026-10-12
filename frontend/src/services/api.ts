// Shared fetch helper — /api and /auth are same-origin from the browser's
// perspective via Vite's dev proxy (see vite.config.ts), so this is just a
// plain fetch, no base URL or CORS/credentials setup needed (unlike
// aroflodupe's original cross-origin services/aroflo.ts).
export class AuthError extends Error {}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    throw new AuthError('Not signed in');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${path} → HTTP ${res.status}`);
  }
  return res.json();
}
