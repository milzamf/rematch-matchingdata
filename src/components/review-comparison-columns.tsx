import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { extractIdentityMappings, type IdentityFieldPair } from '@/lib/result-identity';

type Columns = { input: string[]; reference: string[] };
const ComparisonContext = createContext<Columns | null>(null);
const AvailableContext = createContext<((columns: Columns) => void) | null>(null);
const initial = (mappings: IdentityFieldPair[], side: 'input' | 'reference') =>
  ['name', 'legal_form', 'address', 'city'].flatMap(semantic => {
    const columns = mappings.filter(m => m.semantic === semantic).map(m => side === 'input' ? m.inputColumn : m.referenceColumn).filter((v): v is string => Boolean(v));
    const column = columns.find(c => !c.startsWith('[Generated]')) ?? columns[0];
    return column ? [column] : [];
  });

export function ReviewComparisonColumns({ job, mappings, children }: { job: string | null; mappings: IdentityFieldPair[]; children: ReactNode }) {
  const storageKey = `rematch:comparison-columns:v1:${job}`;
  const [available, setAvailable] = useState<Columns>({ input: [], reference: [] });
  const registerAvailable = useCallback((next: Columns) => setAvailable(previous => {
    const merged = { input: [...new Set([...previous.input, ...next.input])], reference: [...new Set([...previous.reference, ...next.reference])] };
    return JSON.stringify(merged) === JSON.stringify(previous) ? previous : merged;
  }), []);
  const [saved, setSaved] = useState<Columns | null>(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      return value && ['input', 'reference'].every(side => Array.isArray(value[side]) && value[side].every((v: unknown) => typeof v === 'string')) ? value : null;
    } catch { return null; }
  });
  const defaults = useMemo(() => {
    const all = [...mappings, ...extractIdentityMappings({ columnMappings: [...available.input.map(inputColumnName => ({ inputColumnName })), ...available.reference.map(referenceColumnName => ({ referenceColumnName }))] })];
    return { input: initial(all, 'input'), reference: initial(all, 'reference') };
  }, [mappings, available]);
  const value = saved ?? defaults;
  const update = (next: Columns | null) => {
    setSaved(next);
    try { if (next) localStorage.setItem(storageKey, JSON.stringify(next)); else localStorage.removeItem(storageKey); } catch { /* Selection still works when browser storage is unavailable. */ }
  };
  return <AvailableContext.Provider value={registerAvailable}><ComparisonContext.Provider value={value}>
    <details className="relative mb-3 rounded-lg border border-border bg-card text-xs">
      <summary className="cursor-pointer px-3 py-2 font-medium">Kolom pembanding</summary>
      <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
        {(['input', 'reference'] as const).map(side => <fieldset key={side} className="space-y-2">
          <legend className="mb-2 font-semibold">{side === 'input' ? 'Data input' : 'Data acuan'}</legend>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {[...new Set([...available[side], ...mappings.map(m => side === 'input' ? m.inputColumn : m.referenceColumn).filter((v): v is string => Boolean(v))])].map(column => <label key={column} className="flex items-center gap-2">
              <input type="checkbox" checked={value[side].includes(column)} onChange={e => update({ ...value, [side]: e.target.checked ? [...value[side], column] : value[side].filter(c => c !== column) })} />{column}
            </label>)}
          </div>
        </fieldset>)}
        <button type="button" className="w-fit text-muted-foreground underline" onClick={() => update(null)}>Kembalikan kolom default</button>
      </div>
    </details>
    {children}
  </ComparisonContext.Provider></AvailableContext.Provider>;
}

export function ComparisonAvailableColumns({ columns }: { columns?: Columns }) {
  const register = useContext(AvailableContext);
  useEffect(() => { if (columns) register?.(columns); }, [columns, register]);
  return null;
}

export function ComparisonRecord({ record, side }: { record: Record<string, unknown>; side: 'input' | 'reference' }) {
  const columns = useContext(ComparisonContext);
  if (!columns) return null;
  return <div className="max-w-[340px] space-y-1 text-xs">
    {columns[side].length ? columns[side].map((column, index) => <div key={column} className={index === 0 ? 'font-semibold text-foreground' : 'text-[11px] text-muted-foreground'}>
      <span className="text-muted-foreground font-normal">{column}: </span><span className="break-words">{Object.prototype.hasOwnProperty.call(record, column) ? String(record[column] ?? '—') : 'Tidak tersimpan pada snapshot hasil ini'}</span>
    </div>) : <span className="text-muted-foreground">Tidak ada kolom dipilih</span>}
  </div>;
}
