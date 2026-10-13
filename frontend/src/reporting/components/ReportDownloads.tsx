import React, { useState } from 'react';
import { Palette } from '../theme';
import { saveBlob } from '../export/download';

type Built = { blob: Blob; filename: string };

interface Props {
  palette: Palette;
  // Each builds its file when asked; it is saved as soon as it is ready.
  // Leave one out and that button isn't offered.
  excel?: () => Promise<Built>;
  pdf?: () => Promise<Built>;
  // Nothing to put in a report yet (no data loaded).
  disabled?: boolean;
  // What the files hold, said next to the buttons.
  what?: string;
}

// The whole report for the page, one click per format — the same on every
// report page, and at the top where it can be found, not only under
// everything else. (It used to take a "Prepare reports" click first, with
// the download buttons appearing afterwards.)
export const ReportDownloads: React.FC<Props> = ({ palette, excel, pdf, disabled = false, what }) => {
  const [busy, setBusy] = useState<'excel' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'excel' | 'pdf', build: () => Promise<Built>) {
    setBusy(kind);
    setError(null);
    try {
      const { blob, filename } = await build();
      saveBlob(blob, filename);
    } catch (e) {
      setError(`Couldn’t build the ${kind === 'excel' ? 'Excel' : 'PDF'} report${e instanceof Error && e.message ? `: ${e.message}` : '.'}`);
    } finally {
      setBusy(null);
    }
  }

  const button = (kind: 'excel' | 'pdf', label: string, build?: () => Promise<Built>) =>
    build && (
      <button
        type="button"
        onClick={() => run(kind, build)}
        disabled={disabled || busy !== null}
        className="px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-50"
        style={{ border: `1px solid ${palette.border}`, background: palette.surface, color: palette.inkPrimary }}
      >
        {busy === kind ? 'Building…' : label}
      </button>
    );

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: palette.inkSecondary }}>
      <span>Download report</span>
      {button('excel', 'Excel', excel)}
      {button('pdf', 'PDF', pdf)}
      {what && <span style={{ color: palette.inkMuted }}>{what}</span>}
      {error && (
        <span role="alert" style={{ color: palette.statusCritical }}>
          {error}
        </span>
      )}
    </div>
  );
};
