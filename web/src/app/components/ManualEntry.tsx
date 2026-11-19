import { useState } from 'react';
import { FUEL_GRADES, GRADE_LABEL } from '../../models/FuelRecord.ts';
import type { ManualEntry as Entry } from '../../services/ManualEntryService.ts';

interface Props { onAdd: (e: Entry) => string | null }

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blank = (unit: 'mi' | 'km'): Entry => ({ date: today(), time: '12:00', odometer: '', unit, volume: '', amount: '', fullTank: true, tag: '', grade: '', note: '' });

/** Add a fill-up without photos. It counts exactly like a photographed one. */
export function ManualEntry({ onAdd }: Props) {
  const [e, setE] = useState<Entry>(() => blank('mi'));
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setE((x) => ({ ...x, [k]: v }));
  const submit = (ev: { preventDefault(): void }) => {
    ev.preventDefault();
    const msg = onAdd(e);
    setErr(msg);
    if (!msg) setE(blank(e.unit));
  };
  return (
    <details className="manual">
      <summary>Add a fill-up by hand (no photos)</summary>
      <form onSubmit={submit} className="manual__form">
        <label>Date <input type="date" value={e.date} onChange={(x) => set('date', x.target.value)} required /></label>
        <label>Odometer <input inputMode="numeric" value={e.odometer} onChange={(x) => set('odometer', x.target.value)} placeholder="52310" required /></label>
        <label>Unit <select value={e.unit} onChange={(x) => set('unit', x.target.value as 'mi' | 'km')}><option value="mi">miles</option><option value="km">km</option></select></label>
        <label>Fuel (gal/L) <input inputMode="decimal" value={e.volume} onChange={(x) => set('volume', x.target.value)} placeholder="24.6" required /></label>
        <label>Total paid <input inputMode="decimal" value={e.amount} onChange={(x) => set('amount', x.target.value)} placeholder="98.40" required /></label>
        <label>Tag <input list="known-tags" value={e.tag} maxLength={40} onChange={(x) => set('tag', x.target.value)} placeholder="towing" /></label>
        <label>Grade <select value={e.grade} onChange={(x) => set('grade', x.target.value)}>{FUEL_GRADES.map((g) => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}</select></label>
        <label className="manual__check"><input type="checkbox" checked={e.fullTank} onChange={(x) => set('fullTank', x.target.checked)} /> Full tank</label>
        <button type="submit" className="btn btn--primary">Add fill-up</button>
        {err ? <p className="manual__err" role="alert">{err}</p> : null}
      </form>
    </details>
  );
}
