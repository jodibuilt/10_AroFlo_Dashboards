import React, { useRef, useState } from 'react';
import { AuthUser } from '../types';
import { login } from '../services/auth';

interface LoginViewProps {
  onSignedIn: (user: AuthUser) => void;
  // Why the person is seeing this screen again, when it isn't their first
  // visit — "your session has ended".
  notice?: string | null;
}

// What went wrong, in words that say what to do about it. The server only
// ever says "Invalid username or password" (it doesn't reveal which), and a
// request that never arrived fails inside fetch itself.
function explain(err: unknown): string {
  if (err instanceof TypeError) return 'Can’t reach the server. Check your connection, then try again.';
  const message = err instanceof Error ? err.message : '';
  if (/invalid username or password/i.test(message)) {
    return 'That username and password don’t match. Check for typos — passwords are case-sensitive.';
  }
  if (/required/i.test(message)) return 'Enter your username and password.';
  // "Too many sign-in attempts. Try again in N minutes." — the server's own words.
  if (/too many/i.test(message)) return message;
  return 'Something went wrong signing in. Try again in a moment.';
}

export const LoginView: React.FC<LoginViewProps> = ({ onSignedIn, notice = null }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || !password) {
      setError('Enter your username and password.');
      (name ? passwordRef : usernameRef).current?.focus();
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      onSignedIn(await login(name, password));
    } catch (err) {
      setError(explain(err));
      setSubmitting(false);
      // Ready to retype: the password is what is usually wrong.
      window.setTimeout(() => {
        passwordRef.current?.focus();
        passwordRef.current?.select();
      }, 0);
    }
  };

  const watchCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  const field =
    'w-full border border-default rounded-md p-2.5 text-[14px] text-ink bg-white focus:ring-2 focus:ring-accent focus:outline-none';

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink p-4">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="font-bold text-[24px] text-white">AroFlo Dashboards</div>
          <div className="text-[13px] text-white/70 mt-1">KPI Matrix, Work Orders and Invoicing reports, straight from AroFlo</div>
        </div>

        <div className="bg-white rounded-lg border border-default shadow-lg p-7 space-y-5">
          <h1 className="font-semibold text-[17px] text-ink">Sign in</h1>

          {notice && !error && (
            <p className="text-[13px] text-ink bg-surface border border-default rounded-md p-2.5" role="status">
              {notice}
            </p>
          )}
          {error && (
            <p id="login-error" className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-md p-2.5" role="alert">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login-username" className="block text-[12px] font-semibold text-muted mb-1">
                Username
              </label>
              <input
                id="login-username"
                ref={usernameRef}
                type="text"
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'login-error' : undefined}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-[12px] font-semibold text-muted mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={capsLock ? 'login-caps' : error ? 'login-error' : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={watchCapsLock}
                  onKeyUp={watchCapsLock}
                  onBlur={() => setCapsLock(false)}
                  className={`${field} pr-16`}
                />
                {/* A word, not an icon: the app's icons are a web font, and
                    this is the one screen that has to work before anything
                    else has loaded. */}
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[12px] font-semibold text-muted hover:text-ink hover:bg-surface transition-colors"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {capsLock && (
                <p id="login-caps" className="mt-1.5 text-[12px] font-semibold text-amber-700" role="status">
                  Caps Lock is on.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-semibold text-[14px] rounded-md transition-colors"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-[12px] text-muted pt-1 border-t border-default">
            <span className="block pt-3">Forgotten your password, or need an account? Ask an admin.</span>
          </p>
        </div>
      </main>
    </div>
  );
};
