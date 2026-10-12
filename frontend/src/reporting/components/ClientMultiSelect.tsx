import React, { useEffect, useRef, useState } from 'react';
import { Palette } from '../theme';

export interface ClientOption {
  value: string;
  label: string;
}

// Several clients travel as one `view` string — names joined with "||" — so
// the report endpoints and the per-view saved edits keep taking a single
// value (src/views.js splits it). Sorted, so the same set of clients is
// always the same view. No selection is the page's own "everyone" key.
const SEPARATOR = '||';

export function encodeClients(selected: string[], allKey: string): string {
  return selected.length ? [...selected].sort().join(SEPARATOR) : allKey;
}

export function decodeClients(view: string, allKey: string): string[] {
  return view === allKey ? [] : view.split(SEPARATOR).filter(Boolean);
}

interface Props {
  palette: Palette;
  options: ClientOption[];
  // Empty means everyone.
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
}

// Client filter that takes any number of clients: a button that reads like
// the selects beside it, opening a checklist (with a search box once the
// list is long). Don't nest it in a <label> — a click anywhere inside one is
// forwarded to its first control, which here would be the button.
export const ClientMultiSelect: React.FC<Props> = ({ palette, options, selected, onChange, allLabel = 'All clients' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const chosen = new Set(selected);
  const labelOf = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  // Named in the order the list shows them, not the order they were stored in.
  const listed = options.filter((o) => chosen.has(o.value)).map((o) => o.value);
  const picked = [...listed, ...selected.filter((v) => !listed.includes(v))];
  const summary = picked.length === 0 ? allLabel : picked.length <= 2 ? picked.map(labelOf).join(', ') : `${picked.length} clients`;
  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  function toggle(value: string) {
    const next = new Set(chosen);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    // Keep the order the options are listed in, whatever order they were ticked.
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  }

  const row = 'flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer hover:bg-black/5 dash-dark:hover:bg-white/10';
  const line = `1px solid ${palette.border}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Client filter: ${summary}`}
        title={picked.length > 2 ? picked.map(labelOf).join(', ') : undefined}
        className="w-full px-2 py-1.5 rounded-md text-[13px] text-left flex items-center justify-between gap-2"
        style={{ background: palette.surface, border: line, color: palette.inkPrimary }}
      >
        <span className="truncate">{summary}</span>
        <span className="material-symbols-outlined text-[18px] shrink-0" style={{ color: palette.inkMuted }} aria-hidden="true">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 z-30 mt-1 rounded-md shadow-lg overflow-hidden"
          style={{ background: palette.surface, border: line, color: palette.inkPrimary, minWidth: '100%', width: 'max-content', maxWidth: 'min(480px, 90vw)' }}
        >
          {options.length > 8 && (
            <div className="p-2" style={{ borderBottom: line }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients…"
                aria-label="Search clients"
                className="w-full px-2 py-1 rounded-md text-[12px]"
                style={{ background: palette.pagePlane, border: line, color: palette.inkPrimary }}
              />
            </div>
          )}
          <div className="overflow-auto py-1" style={{ maxHeight: 280 }}>
            {!query && (
              <label className={`${row} font-semibold`}>
                <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
                <span className="truncate">{allLabel}</span>
              </label>
            )}
            {shown.map((o) => (
              <label key={o.value} className={row}>
                <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {shown.length === 0 && (
              <div className="px-3 py-2 text-[12px]" style={{ color: palette.inkMuted }}>
                No clients match “{query}”.
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 px-3 py-2 text-[12px]" style={{ borderTop: line }}>
            <span style={{ color: palette.inkMuted }}>{selected.length === 0 ? 'Showing everyone' : `${selected.length} selected`}</span>
            <button type="button" onClick={() => setOpen(false)} className="font-semibold" style={{ color: palette.accentBlue }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
