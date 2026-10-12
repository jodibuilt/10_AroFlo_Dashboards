import { useEffect, useState } from 'react';
import { ThemeMode } from '../reporting/theme';
import { useMediaQuery } from './useMediaQuery';

// The key is older than the app-wide switch — it was the Reports page's own
// setting — and is kept so nobody's saved choice is lost. index.html and
// admin.html read it too, to apply the theme before first paint.
const STORAGE_KEY = 'reporting-theme';

function loadMode(): ThemeMode {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

// The whole app's light / dark / match-the-device setting. Dark is the
// `dash-dark` class on <html>: the Reports components already style against
// it, and dark.css re-points the design tokens under it for everything else.
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(loadMode);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mode));
    } catch {
      /* noop */
    }
  }, [mode]);

  useEffect(() => {
    document.documentElement.classList.toggle('dash-dark', isDark);
  }, [isDark]);

  return { mode, setMode };
}
