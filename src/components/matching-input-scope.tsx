import { SearchableSelect } from '@/components/ui/searchable-select';
import { detectWilayahColumnRole, WILAYAH_PROVINCES_LIST, WILAYAH_REGENCIES_LIST } from '@/lib/wilayah-normalizer';

export type MatchingInputScope = {
  provinceCodes: string[];
  regencyCodes: string[];
  provinceColumn?: string | null;
  regencyColumn?: string | null;
};
export const emptyInputScope = (): MatchingInputScope => ({ provinceCodes: [], regencyCodes: [] });

export function MatchingInputScopePanel({ columns, value, onChange, disabled }: {
  columns: { name: string }[]; value: MatchingInputScope;
  onChange: (value: MatchingInputScope) => void; disabled?: boolean;
}) {
  const detect = (prefix: string) => columns.find(c => detectWilayahColumnRole(c.name)?.startsWith(prefix))?.name;
  const provinceColumn = value.provinceColumn || detect('PROV_');
  const regencyColumn = value.regencyColumn || detect('KAB_');
  const canFilter = Boolean(provinceColumn || regencyColumn);
  const provinces = WILAYAH_PROVINCES_LIST.map(p => ({ value: p.kd_prov, label: p.nm_prov }));
  const regencies = WILAYAH_REGENCIES_LIST.filter(r => !value.provinceCodes.length || value.provinceCodes.includes(r.kd_prov))
    .map(r => ({ value: r.id_kab, label: r.full_name, description: r.nm_prov }));
  const toggle = (values: string[], code: string) => values.includes(code) ? values.filter(v => v !== code) : [...values, code];
  const sourceOptions = [{ value: '__auto__', label: 'Deteksi otomatis' }, ...columns.map(c => ({ value: c.name, label: c.name }))];
  return <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">Wilayah input yang akan dicocokkan</h3>
        <p className="mt-1 text-xs text-muted-foreground">Berlaku untuk seluruh baris input sebelum matching. Data acuan tetap lengkap.</p></div>
      <button type="button" disabled={disabled} className="text-xs text-muted-foreground underline disabled:opacity-50" onClick={() => onChange({ ...value, provinceCodes: [], regencyCodes: [] })}>Semua wilayah</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><p className="text-xs font-medium">Provinsi input</p>
        <SearchableSelect multiple values={value.provinceCodes} options={provinces} placeholder="Semua provinsi" aria-label="Provinsi untuk matching" disabled={disabled || !canFilter}
          onChange={code => { const next = toggle(value.provinceCodes, code); onChange({ ...value, provinceCodes: next, regencyCodes: value.regencyCodes.filter(r => !next.length || next.includes(r.slice(0, 2))) }); }} />
      </div>
      <div className="space-y-1.5"><p className="text-xs font-medium">Kabupaten/kota input</p>
        <SearchableSelect multiple values={value.regencyCodes} options={regencies} placeholder="Semua kabupaten/kota" aria-label="Kabupaten/kota untuk matching" disabled={disabled || !regencyColumn}
          onChange={code => onChange({ ...value, regencyCodes: toggle(value.regencyCodes, code) })} />
      </div>
    </div>
    <p className="text-xs text-muted-foreground" role="status">{value.provinceCodes.length || value.regencyCodes.length
      ? `Cakupan: ${value.provinceCodes.length ? provinces.filter(p => value.provinceCodes.includes(p.value)).map(p => p.label).join(', ') : 'semua provinsi'}${value.regencyCodes.length ? ` · ${regencies.filter(r => value.regencyCodes.includes(r.value)).map(r => r.label).join(', ')}` : ' · semua kabupaten/kota di provinsi tersebut'}. Baris di luar cakupan tidak diproses.`
      : 'Tanpa pembatasan wilayah: semua baris input akan diproses.'}</p>
    <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Kolom sumber wilayah{!canFilter ? ' — pilih kolom terlebih dahulu' : ''}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(['provinceColumn', 'regencyColumn'] as const).map(key => <div key={key} className="space-y-1.5">
          <p>{key === 'provinceColumn' ? 'Kolom provinsi' : 'Kolom kabupaten/kota'}</p>
          <SearchableSelect value={value[key] || '__auto__'} options={sourceOptions} disabled={disabled} aria-label={key === 'provinceColumn' ? 'Kolom provinsi sumber' : 'Kolom kabupaten/kota sumber'}
            onChange={column => onChange({ ...value, [key]: column === '__auto__' ? null : column })} />
        </div>)}
      </div>
    </details>
  </section>;
}
