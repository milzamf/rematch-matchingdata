import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Columns3, RotateCcw, Search, X } from 'lucide-react';
import { extractIdentityMappings, type IdentityFieldPair } from '@/lib/result-identity';

type Columns = { input: string[]; reference: string[] };
type ComparisonSettings = {
  columns: Columns;
  available: Columns;
  update: (next: Columns | null) => void;
};
const ComparisonContext = createContext<ComparisonSettings | null>(null);
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
  const options = useMemo(() => ({
    input: [...new Set([...available.input, ...mappings.flatMap(m => m.inputColumn ? [m.inputColumn] : []), ...value.input])],
    reference: [...new Set([...available.reference, ...mappings.flatMap(m => m.referenceColumn ? [m.referenceColumn] : []), ...value.reference])],
  }), [available, mappings, value]);
  return <AvailableContext.Provider value={registerAvailable}><ComparisonContext.Provider value={{ columns: value, available: options, update }}>
    {children}
  </ComparisonContext.Provider></AvailableContext.Provider>;
}

/** Place beside the table or detail that uses the same selection. */
export function ComparisonColumnControls() {
  const settings = useContext(ComparisonContext);
  const [search, setSearch] = useState({ input: '', reference: '' });
  if (!settings) return null;
  const { columns, available, update } = settings;
  return <details className="group mb-3 rounded-lg border border-border bg-card text-xs">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 font-medium transition-colors hover:bg-secondary/40 [&::-webkit-details-marker]:hidden">
      <Columns3 className="size-4 text-muted-foreground" />
      <span>Kolom pembanding</span>
      <span className="font-normal text-muted-foreground">{columns.input.length} input · {columns.reference.length} acuan</span>
      <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-border p-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {(['input', 'reference'] as const).map(side => {
          const query = search[side];
          const filtered = available[side].filter(column => column.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
          const label = side === 'input' ? 'Data input' : 'Data acuan';
          return <fieldset key={side} className="min-w-0">
            <legend className="mb-2 font-semibold">{label}</legend>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <input type="search" aria-label={`Cari kolom ${side === 'input' ? 'input' : 'acuan'}`} placeholder="Cari nama kolom…" value={query}
                onChange={e => setSearch(previous => ({ ...previous, [side]: e.target.value }))}
                className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 [&::-webkit-search-cancel-button]:hidden" />
              {query && <button type="button" aria-label={`Hapus pencarian kolom ${side === 'input' ? 'input' : 'acuan'}`} onClick={() => setSearch(previous => ({ ...previous, [side]: '' }))}
                className="absolute right-1 top-1 grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-brand"><X className="size-3.5" /></button>}
            </div>
            <div className="max-h-52 overflow-y-auto overscroll-contain rounded-md border border-border/60 p-1">
              {filtered.length ? filtered.map(column => <label key={column} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-secondary/50">
                <input type="checkbox" checked={columns[side].includes(column)} className="mt-0.5 size-3.5 shrink-0 accent-brand"
                  onChange={e => update({ ...columns, [side]: e.target.checked ? [...columns[side], column] : columns[side].filter(c => c !== column) })} />
                <span className="min-w-0 break-words">{column}</span>
              </label>) : <p role="status" className="px-2 py-4 text-muted-foreground">{query ? 'Kolom tidak ditemukan.' : 'Belum ada kolom tersedia.'}</p>}
            </div>
          </fieldset>;
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <p className="text-muted-foreground">Pilihan berlaku untuk tabel dan detail record.</p>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => update(null)}>
          <RotateCcw className="size-3.5" />Kembalikan default
        </button>
      </div>
    </div>
  </details>;
}

/** Full values in the detail dialog, with the same fields as the review table. */
export function ComparisonRecordDetails({ record, side }: { record: Record<string, unknown>; side: 'input' | 'reference' }) {
  const settings = useContext(ComparisonContext);
  if (!settings) return null;
  return <dl className="space-y-1.5 text-xs">
    {settings.columns[side].length ? settings.columns[side].map(column => <div key={column} className="grid grid-cols-1 items-start gap-1 border-b border-border/30 py-1.5 last:border-0 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-2">
      <dt className="break-words font-semibold">{column}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words font-medium leading-relaxed select-all">{recordValue(record, column)}</dd>
    </div>) : <p className="py-2 text-muted-foreground">Tidak ada kolom dipilih.</p>}
  </dl>;
}

export const useHasComparisonColumns = () => useContext(ComparisonContext) !== null;

function recordValue(record: Record<string, unknown>, column: string): string {
  if (!Object.prototype.hasOwnProperty.call(record, column)) return 'Tidak tersimpan pada snapshot hasil ini';
  const value = record[column];
  return value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function ComparisonAvailableColumns({ columns }: { columns?: Columns }) {
  const register = useContext(AvailableContext);
  useEffect(() => { if (columns) register?.(columns); }, [columns, register]);
  return null;
}

export function ComparisonRecord({ record, side }: { record: Record<string, unknown>; side: 'input' | 'reference' }) {
  const settings = useContext(ComparisonContext);
  if (!settings) return null;
  const { columns } = settings;
  return <div className="max-w-[340px] space-y-1 text-xs">
    {columns[side].length ? columns[side].map((column, index) => <div key={column} className={index === 0 ? 'font-semibold text-foreground' : 'text-[11px] text-muted-foreground'}>
      <span className="text-muted-foreground font-normal">{column}: </span><span className="break-words">{recordValue(record, column)}</span>
    </div>) : <span className="text-muted-foreground">Tidak ada kolom dipilih</span>}
  </div>;
}
