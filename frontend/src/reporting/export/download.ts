// Handing a built report to the browser to save, and writing a table out as
// CSV. Shared by every download on the report pages.

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  // A cell starting with = + - or @ is run as a formula by Excel. These are
  // AroFlo's free-text fields (task names, client names), so make it text.
  // A plain number ("-5") or a lone dash is left as it is.
  const safe = value.length > 1 && /^[=+\-@]/.test(value) && Number.isNaN(Number(value)) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// A table as a CSV file Excel opens cleanly: comma-separated, quoted where
// needed, with the marker that tells Excel it is UTF-8 (without it "–" and
// "’" come out as junk).
export function csvBlob(headers: string[], rows: string[][]): Blob {
  const lines = [headers, ...rows].map((row) => row.map((cell) => csvCell(String(cell ?? ''))).join(','));
  return new Blob(['﻿', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' });
}

// "Work Orders P1" -> "work-orders-p1", for a file name.
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
