/**
 * A fill-up typed in by hand (no photos): date, odometer, fuel and amount. It becomes a pump row and an
 * odometer row with the same time, so it pairs and counts exactly like a photographed fill-up, and it
 * is exported and imported like any other row.
 */
import { cleanText, FUEL_GRADES, TEXT_LIMITS, type FuelGrade, type FuelRecord } from '../models/FuelRecord.ts';
import { fieldOf } from './ImportService.ts';
import { newRecord } from './RecordService.ts';

export interface ManualEntry {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM", default noon */
  time?: string;
  odometer: string;
  unit: 'mi' | 'km';
  volume: string;
  amount: string;
  fullTank: boolean;
  tag?: string;
  grade?: string;
  note?: string;
}

export type ManualResult = { ok: true; records: FuelRecord[] } | { ok: false; error: string };

const num = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

function localOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

export function manualFillUp(e: ManualEntry, newId: () => string, now = new Date()): ManualResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return { ok: false, error: 'Enter the date of the fill-up.' };
  const time = /^\d{2}:\d{2}$/.test(e.time ?? '') ? e.time! : '12:00';
  const when = new Date(`${e.date}T${time}:00`);
  if (Number.isNaN(when.getTime())) return { ok: false, error: 'That date is not valid.' };
  if (when.getTime() > now.getTime() + 86_400_000) return { ok: false, error: 'That date is in the future.' };
  const odo = num(e.odometer), vol = num(e.volume), amt = num(e.amount);
  if (odo === null || !Number.isInteger(odo) || odo <= 0 || odo > 9_999_999) return { ok: false, error: 'Odometer: a whole number, such as 52310.' };
  if (vol === null || vol <= 0 || vol > 1000) return { ok: false, error: 'Fuel: the gallons or litres, such as 24.6.' };
  if (amt === null || amt <= 0 || amt > 100000) return { ok: false, error: 'Amount: the total paid, such as 98.40.' };
  const grade = (FUEL_GRADES as readonly string[]).includes(e.grade ?? '') ? ((e.grade ?? '') as FuelGrade) : '';

  const at = `${e.date}T${time}:00${localOffset(when)}`;
  const base = { imported: true, status: 'confirmed' as const, capturedAt: at, capturedSource: 'exif' as const, processedAt: null, note: 'Typed in by hand (no photo).' };
  const pump: FuelRecord = {
    ...newRecord(newId(), 'typed-fill-up', 0), ...base, kind: 'fuel_pump',
    volume: fieldOf(vol, true), amount: fieldOf(amt, true),
    fullTank: e.fullTank, tag: cleanText(e.tag ?? '', TEXT_LIMITS.tag), grade, userNote: cleanText(e.note ?? '', TEXT_LIMITS.userNote),
  };
  const odometer: FuelRecord = {
    ...newRecord(newId(), 'typed-odometer', 0), ...base, kind: 'odometer',
    odometer: fieldOf(odo, true), odometerUnit: e.unit,
  };
  return { ok: true, records: [pump, odometer] };
}
