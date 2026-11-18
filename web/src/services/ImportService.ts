/**
 * Import of a CSV that this tool exported earlier, so a new month can continue
 * from the last one. The tool saves nothing in the browser: the exported file
 * is the history, and the person keeps it.
 *
 * The file is untrusted input. It is parsed strictly, every value is checked
 * against a sane range, limits are enforced, and a row that fails is skipped
 * with a reason instead of being guessed at. Nothing is ever executed or
 * fetched from it, and no photo is involved.
 */
import { emptyField, effectiveValue, type FieldValue, type FuelRecord, type RecordKind, type RecordStatus } from '../models/FuelRecord.ts';
import { newRecord } from './RecordService.ts';

export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 5000 } as const;

export interface ImportSkip { line: number; reason: string }
export interface ImportResult {
  records: FuelRecord[];
  skipped: ImportSkip[];
  /** Set when the whole file was refused. */
  error: string | null;
}

/** RFC 4180 CSV: quoted cells, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

/** Undo the formula-injection guard added on export (a leading ' before = + - @). */
function unguard(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

const RANGE = {
  volume: [0, 1000], amount: [0, 100000], unitPrice: [0, 1000], odometer: [0, 9_999_999], trip: [0, 99_999.9],
} as const;

function num(raw: string | undefined, range: readonly [number, number], integer = false): { value: number | null; bad: boolean } {
  const v = (raw ?? '').trim();
  if (v === '') return { value: null, bad: false };
  if (!/^\d+(\.\d+)?$/.test(v)) return { value: null, bad: true };
  const n = Number(v);
  if (!Number.isFinite(n) || n < range[0] || n > range[1] || (integer && !Number.isInteger(n))) return { value: null, bad: true };
  return { value: n, bad: false };
}

const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?$/;

function fieldOf(value: number | null, asCorrection: boolean): FieldValue {
  if (value === null) return emptyField();
  return asCorrection
    ? { detected: null, detectedText: null, confidence: 1, corrected: value, derived: null }
    : { detected: value, detectedText: String(value), confidence: 1, corrected: null, derived: null };
}

export function importCsv(text: string, newId: () => string): ImportResult {
  const fail = (error: string): ImportResult => ({ records: [], skipped: [], error });
  if (text.length > IMPORT_LIMITS.maxBytes) return fail('That file is too large to be one of this tool’s exports.');
  const table = parseCsv(text);
  if (table.length < 2) return fail('The file has no rows to import.');
  if (table.length - 1 > IMPORT_LIMITS.maxRows) return fail(`The file has more than ${IMPORT_LIMITS.maxRows} rows.`);
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col('file_name') < 0 || (col('fuel_volume') < 0 && col('odometer') < 0)) {
    return fail('This does not look like a file exported by this tool (expected columns such as file_name, fuel_volume, odometer).');
  }
  const get = (r: string[], name: string) => { const i = col(name); return i < 0 ? undefined : r[i]; };

  const records: FuelRecord[] = [];
  const skipped: ImportSkip[] = [];
  for (let n = 1; n < table.length; n++) {
    const r = table[n];
    const line = n + 1;
    const skip = (reason: string) => skipped.push({ line, reason });
    const fileName = unguard((get(r, 'file_name') ?? '').trim()).slice(0, 200);
    if (!fileName) { skip('no file name'); continue; }

    const vol = num(get(r, 'fuel_volume'), RANGE.volume);
    const amt = num(get(r, 'amount'), RANGE.amount);
    const price = num(get(r, 'unit_price'), RANGE.unitPrice);
    const odo = num(get(r, 'odometer'), RANGE.odometer, true);
    const trip = num(get(r, 'trip_meter'), RANGE.trip);
    if (vol.bad || amt.bad || price.bad || odo.bad || trip.bad) { skip('a number is missing digits or out of range'); continue; }

    let kind = (get(r, 'kind') ?? '').trim().toLowerCase();
    if (kind === 'unrecognized') { continue; } // nothing to keep
    if (kind === '') kind = vol.value !== null || amt.value !== null ? 'fuel_pump' : 'odometer';
    if (kind !== 'fuel_pump' && kind !== 'odometer') { skip(`unknown kind “${kind.slice(0, 20)}”`); continue; }
    if (kind === 'fuel_pump' && vol.value === null && amt.value === null) { skip('pump row without fuel or amount'); continue; }
    if (kind === 'odometer' && odo.value === null && trip.value === null) { skip('odometer row without a reading'); continue; }

    const capRaw = (get(r, 'captured_at') ?? '').trim();
    if (capRaw && !TIME_RE.test(capRaw)) { skip('unreadable date'); continue; }
    const srcRaw = (get(r, 'captured_source') ?? '').trim();
    const unit = (get(r, 'odometer_unit') ?? '').trim();
    const edited = (get(r, 'user_corrected') ?? '').trim().toLowerCase() === 'yes';
    const priceSource = (get(r, 'unit_price_source') ?? '').trim();
    const st = (get(r, 'record_status') ?? '').trim();
    const status: RecordStatus = st === 'confirmed' ? 'confirmed' : st === 'detected' ? 'detected' : 'review';

    const rec: FuelRecord = {
      ...newRecord(newId(), fileName, 0),
      kind: kind as RecordKind,
      status,
      imported: true,
      capturedAt: capRaw || null,
      capturedSource: capRaw ? (srcRaw === 'file' ? 'file' : 'exif') : null,
      volume: fieldOf(vol.value, edited),
      amount: fieldOf(amt.value, edited),
      // A unit price that was only calculated is recalculated; one that was read or typed is kept.
      unitPrice: priceSource === 'derived' ? emptyField() : fieldOf(price.value, edited),
      odometer: fieldOf(odo.value, edited),
      trip: fieldOf(trip.value, edited),
      odometerUnit: unit === 'mi' || unit === 'km' ? unit : null,
      fullTank: (get(r, 'full_tank') ?? '').trim().toLowerCase() !== 'no',
      processedAt: (get(r, 'processed_at') ?? '').trim().slice(0, 40) || null,
      note: 'Imported from a CSV file (no photo here).',
    };
    records.push(rec);
  }
  return { records, skipped, error: null };
}

/** Identity of a reading: the same kind, time and values. Used so re-importing or re-uploading never double counts. */
export function recordKey(r: FuelRecord): string {
  const v = (f: FieldValue) => { const x = effectiveValue(f); return x === null ? '' : String(x); };
  return [r.kind, r.capturedAt ?? `name:${r.fileName}`, v(r.volume), v(r.amount), v(r.odometer), v(r.trip)].join('|');
}

/** Drop later records whose reading is identical to an earlier one (imported rows come first). */
export function dedupeRecords(records: FuelRecord[]): FuelRecord[] {
  const seen = new Set<string>();
  const out: FuelRecord[] = [];
  for (const r of records) {
    // Records that carry no value yet (queued, processing) are never duplicates.
    if (r.kind === null || r.kind === 'unrecognized') { out.push(r); continue; }
    const k = recordKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
