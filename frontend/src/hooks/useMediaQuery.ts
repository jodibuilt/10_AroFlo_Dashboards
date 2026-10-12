import { useEffect, useState } from 'react';

// Small SSR-safe media-query hook. Used by the shell to decide between the
// fixed desktop sidebar rail and the mobile off-canvas drawer.
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// Tailwind's `lg` breakpoint — the point where the sidebar becomes a
// permanent rail instead of a drawer.
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
