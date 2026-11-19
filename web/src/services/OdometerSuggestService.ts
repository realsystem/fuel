/**
 * Suggests a corrected odometer value for a reading that contradicts the others.
 *
 * Odometers never go down and a vehicle only covers so much distance in a given time. When one
 * reading breaks that, the likeliest cause is a single misread digit (1 for 7, 3 for 8, ...). If
 * exactly one single-digit change makes the reading fit between its neighbours, it is offered as a
 * suggestion. It is never applied automatically: the person looks at the photo and accepts or ignores it.
 */
import { effectiveValue, isTrustedCaptureSource, type FuelRecord } from '../models/FuelRecord.ts';
import { captureTimeMs } from './TripService.ts';

export interface OdometerSuggestion {
  recordId: string;
  fileName: string;
  read: number;
  suggested: number;
  /** The nearest consistent readings before and after, for showing why. */
  before: number | null;
  after: number | null;
}

/** Pairs of digits a display or a classifier can mix up. */
const CONFUSABLE: ReadonlyArray<readonly [string, string]> = [
  ['1', '7'], ['3', '8'], ['0', '8'], ['5', '6'], ['6', '8'], ['5', '9'], ['0', '6'], ['8', '9'], ['0', '9'], ['2', '7'], ['4', '9'],
];
const confusable = (a: string, b: string) => CONFUSABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Generous distance bound: a day of hard driving is ~600; never less than one long trip. */
const maxAllowed = (days: number) => 1200 + 600 * Math.max(0, days);

function timeOf(r: FuelRecord): number | null {
  if (!r.capturedAt || !isTrustedCaptureSource(r.capturedSource)) return null;
  const m = /^(.*?)([+-]\d{2}:\d{2}|Z)?$/.exec(r.capturedAt);
  return m ? captureTimeMs(m[1], m[2] ?? null) : null;
}

export function suggestOdometerFixes(records: FuelRecord[]): OdometerSuggestion[] {
  const pts = records
    .filter((r) => r.kind === 'odometer' && r.status !== 'failed' && r.status !== 'queued' && r.status !== 'processing')
    .map((r) => ({ r, v: effectiveValue(r.odometer), t: timeOf(r) }))
    .filter((x): x is { r: FuelRecord; v: number; t: number } => x.v !== null && x.v > 0 && Number.isInteger(x.v) && x.t !== null)
    .sort((a, b) => a.t - b.t || a.v - b.v);
  if (pts.length < 2) return [];

  // The longest run that never goes down is taken as right; the rest contradict it.
  const len = pts.map(() => 1), prev = pts.map(() => -1);
  for (let i = 0; i < pts.length; i++) for (let j = 0; j < i; j++) if (pts[j].v <= pts[i].v && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  let end = 0;
  for (let i = 1; i < pts.length; i++) if (len[i] > len[end]) end = i;
  const keep = new Set<number>();
  for (let i = end; i >= 0; i = prev[i]) keep.add(i);

  const out: OdometerSuggestion[] = [];
  pts.forEach((p, i) => {
    if (keep.has(i)) return;
    let lo: (typeof pts)[number] | null = null, hi: (typeof pts)[number] | null = null;
    for (let j = i - 1; j >= 0; j--) if (keep.has(j)) { lo = pts[j]; break; }
    for (let j = i + 1; j < pts.length; j++) if (keep.has(j)) { hi = pts[j]; break; }
    const text = String(p.v);
    const fits = (c: number) =>
      (!lo || (c >= lo.v && c - lo.v <= maxAllowed((p.t - lo.t) / 86_400_000))) &&
      (!hi || (c <= hi.v && hi.v - c <= maxAllowed((hi.t - p.t) / 86_400_000)));
    const cands: Array<{ value: number; likely: boolean }> = [];
    for (let k = 0; k < text.length; k++) {
      for (const d of '0123456789') {
        if (d === text[k] || (k === 0 && d === '0')) continue;
        const c = Number(text.slice(0, k) + d + text.slice(k + 1));
        if (fits(c)) cands.push({ value: c, likely: confusable(text[k], d) });
      }
    }
    const likely = cands.filter((c) => c.likely);
    const pick = likely.length === 1 ? likely[0] : cands.length === 1 ? cands[0] : null;
    if (pick) out.push({ recordId: p.r.id, fileName: p.r.fileName, read: p.v, suggested: pick.value, before: lo?.v ?? null, after: hi?.v ?? null });
  });
  return out;
}
