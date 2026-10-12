// Minimal RFC-4180-ish CSV parser. Browser-side, no dependency.
// Handles quoted fields, embedded commas / newlines / doubled quotes, and
// CRLF or LF line endings. Returns an array of row objects keyed by the
// header row. Every value is a string (empty string for blank cells).

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\r') {
      // swallow; the \n (or end) closes the record
    } else if (c === '\n') {
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else {
      field += c;
    }
  }
  // trailing field / record (file without a final newline)
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    // skip a fully blank line
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const obj: CsvRow = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    rows.push(obj);
  }
  return { headers, rows };
}
