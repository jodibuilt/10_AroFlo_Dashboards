import React, { useRef, useState } from 'react';
import { consolidate, readCsv, toCsv, ConsolidateResult, ParsedCsv } from './consolidate';

interface Loaded {
  name: string;
  parsed: ParsedCsv;
}

const FIELD =
  'px-3 py-2 rounded-md border border-default bg-white text-[13px] text-ink focus:outline-none focus:border-accent';

export const WoConsolidatorTab: React.FC = () => {
  const [wo, setWo] = useState<Loaded | null>(null);
  const [obj, setObj] = useState<Loaded | null>(null);
  const [filterVal, setFilterVal] = useState('31-08-2026');
  const [dueDateVal, setDueDateVal] = useState('31/08/2026');
  const [result, setResult] = useState<ConsolidateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const woRef = useRef<HTMLInputElement>(null);
  const objRef = useRef<HTMLInputElement>(null);

  const ready = !!wo && !!obj;

  async function pick(file: File, set: (l: Loaded) => void, label: string) {
    setError(null);
    try {
      const text = await file.text();
      set({ name: file.name, parsed: readCsv(text) });
      setResult(null);
    } catch (e) {
      setError(`Could not read ${label}: ${e instanceof Error ? e.message : e}`);
    }
  }

  function process() {
    if (!wo || !obj) return;
    setBusy(true);
    setError(null);
    try {
      setResult(consolidate(wo.parsed, obj.parsed, filterVal, dueDateVal));
    } catch (e) {
      setResult(null);
      setError(`An error occurred while processing: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setWo(null);
    setObj(null);
    setResult(null);
    setError(null);
    if (woRef.current) woRef.current.value = '';
    if (objRef.current) objRef.current.value = '';
  }

  function download() {
    if (!result) return;
    const blob = new Blob([toCsv(result.headers, result.rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'consolidated_work_orders.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const fileButton = (
    ref: React.RefObject<HTMLInputElement>,
    loaded: Loaded | null,
    onFile: (f: File) => void,
    label: string,
  ) => (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-muted">{label}</span>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <button
        onClick={() => ref.current?.click()}
        className="px-3 py-2 rounded-md border border-default bg-white text-[13px] text-left hover:border-accent transition-colors"
      >
        {loaded ? (
          <span className="text-ink">
            {loaded.name}{' '}
            <span className="text-muted">· {loaded.parsed.rows.length} rows</span>
          </span>
        ) : (
          <span className="text-muted">Choose CSV…</span>
        )}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-muted">
        Merge a Work Order List with a WO Object List, filter to PM work orders in a due-date window, and produce one
        consolidated row per work order in the import schema.
      </p>

      {/* Inputs */}
      <div className="rounded-md border border-default bg-[#ffffff] p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {fileButton(woRef, wo, (f) => pick(f, setWo, 'Work Order List'), 'Work Order List')}
        {fileButton(objRef, obj, (f) => pick(f, setObj, 'WO Object List'), 'WO Object List')}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-muted">Filter Due Date (substring of “Complete Due”)</span>
          <input className={FIELD} value={filterVal} onChange={(e) => setFilterVal(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-muted">Final Due Date (written to output)</span>
          <input className={FIELD} value={dueDateVal} onChange={(e) => setDueDateVal(e.target.value)} />
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-[13px] p-3 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={process}
          disabled={!ready || busy}
          className="px-4 py-2 rounded-md bg-accent text-white font-semibold text-[13px] hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Processing…' : 'Process & Merge Data'}
        </button>
        <button
          onClick={download}
          disabled={!result}
          className="px-4 py-2 rounded-md border border-default text-ink font-semibold text-[13px] hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Download Final CSV
        </button>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-md text-muted font-semibold text-[13px] hover:bg-surface transition-colors"
        >
          Reset
        </button>
        {!ready && <span className="text-[12px] text-muted">Load both CSV files to enable processing.</span>}
      </div>

      {/* Result */}
      {result && (
        <>
          <div className="flex flex-wrap gap-4 text-[12px] text-muted">
            <span>
              WO rows in <b className="text-ink">{result.stats.woRowsIn.toLocaleString()}</b>
            </span>
            <span>
              after due-date filter <b className="text-ink">{result.stats.afterDueFilter.toLocaleString()}</b>
            </span>
            <span>
              after PM filter <b className="text-ink">{result.stats.afterPmFilter.toLocaleString()}</b>
            </span>
            <span>
              work orders out <b className="text-ink">{result.stats.workOrdersOut.toLocaleString()}</b>
            </span>
          </div>

          {result.rows.length === 0 ? (
            <div className="rounded-md border border-default bg-[#ffffff] p-6 text-[13px] text-muted">
              No rows matched the filters. Check the Filter Due Date value against the “Complete Due” column, and that the
              Work Order List has PM-priority rows.
            </div>
          ) : (
            <div>
              <div className="text-[12px] font-semibold text-muted mb-2">
                Preview — final output schema (first {Math.min(result.rows.length, 100)} of {result.rows.length})
              </div>
              <div className="overflow-auto rounded-md border border-default" style={{ maxHeight: 460 }}>
                <table className="text-[12px] text-ink border-collapse">
                  <thead>
                    <tr>
                      {result.headers.map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 font-semibold text-muted bg-surface sticky top-0 z-10 whitespace-nowrap border-b border-default"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 100).map((r, i) => (
                      <tr key={i} className={i % 2 ? 'bg-canvas' : ''}>
                        {result.headers.map((h) => (
                          <td
                            key={h}
                            className={`px-3 py-1.5 whitespace-nowrap border-b border-default ${
                              h === 'Task Type' ? 'text-[#6D28D9] font-semibold' : h === 'Cust ON' ? 'text-[#0058BE] font-semibold' : ''
                            }`}
                          >
                            {r[h]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
