import React, { useState } from 'react';
import { AuthUser } from '../types';
import { login } from '../services/auth';

interface LoginViewProps {
  onSignedIn: (user: AuthUser) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSignedIn }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(username, password);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink p-4">
      <div className="bg-white max-w-sm w-full rounded-lg border border-default shadow-lg p-8 space-y-5">
        <div>
          <h1 className="font-bold text-[20px] text-ink">AroFlo Dashboards</h1>
          <p className="text-[13px] text-muted mt-1">Sign in to continue</p>
        </div>

        {error && (
          <p
            className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md p-2.5"
            role="alert"
          >
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-username" className="block text-[12px] font-semibold text-muted uppercase mb-1">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              required
              autoFocus
              autoComplete="username"
              aria-invalid={error ? true : undefined}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-default rounded-md p-2.5 text-[14px] focus:ring-2 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-[12px] font-semibold text-muted uppercase mb-1">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-default rounded-md p-2.5 pr-11 text-[14px] focus:ring-2 focus:ring-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:text-ink hover:bg-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-semibold text-[14px] rounded-md transition-colors"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};
