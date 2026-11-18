/**
 * Statistics from odometer photos alone (no fill-ups needed): how far the
 * vehicle went between the first and the last reading, and at what rate.
 *
 * Readings are ordered by photo time (EXIF; a file's saved date does not count).
 * A reading lower than one taken earlier cannot be right (odometers do not go
 * backwards), so it is flagged and left out instead of corrupting the distance.
 */
import { effectiveValue, type FuelRecord } from '../models/FuelRecord.ts';
import { captureTimeMs } from './TripService.ts';

export interface OdometerPoint {
  recordId: string;
  fileName: string;
  value: number;
  date: string;
  time: number;
}

export interface OdometerStats {
  /** Confirmed or detected odometer readings. */
  readings: number;
  /** Readings with a usable photo time. */
  timed: number;
  untimed: number;
  unit: 'mi' | 'km' | null;
  first: OdometerPoint | null;
  last: OdometerPoint | null;
  /** Readings that were lower than an earlier one, left out of the figures. */
  inconsistent: OdometerPoint[];
  distance: number | null;
  days: number | null;
  perDay: number | null;
  perMonth: number | null;
  perYear: number | null;
  /** Mean days between consecutive readings used. */
  averageDaysBetween: number | null;
  /** Lowest and highest reading, whether or not it has a time. */
  min: number | null;
  max: number | null;
}

const MIN_SPAN_DAYS = 1;

function timeOf(r: FuelRecord): number | null {
  if (!r.capturedAt || r.capturedSource !== 'exif') return null;
  const m = /^(.*?)([+-]\d{2}:\d{2}|Z)?$/.exec(r.capturedAt);
  return m ? captureTimeMs(m[1], m[2] ?? null) : null;
}

export function computeOdometerStats(records: FuelRecord[]): OdometerStats {
  const used = records.filter((r) => r.kind === 'odometer' && (r.status === 'confirmed' || r.status === 'detected'));
  const all = used.map((r) => ({ r, v: effectiveValue(r.odometer), t: timeOf(r) })).filter((x): x is { r: FuelRecord; v: number; t: number | null } => x.v !== null && x.v > 0);

  const timed = all.filter((x): x is { r: FuelRecord; v: number; t: number } => x.t !== null).sort((a, b) => a.t - b.t || a.v - b.v);
  const point = (x: { r: FuelRecord; v: number; t: number }): OdometerPoint => ({ recordId: x.r.id, fileName: x.r.fileName, value: x.v, date: new Date(x.t).toISOString().slice(0, 10), time: x.t });

  // Keep the longest run of readings that never goes down (longest non-decreasing subsequence in
  // time order). Anything outside it contradicts the rest: a misread digit, whichever end it is on.
  const pts = timed.map(point);
  const len = pts.map(() => 1), prev = pts.map(() => -1);
  for (let i = 0; i < pts.length; i++) {
    for (let j = 0; j < i; j++) if (pts[j].value <= pts[i].value && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
  }
  let end = 0;
  for (let i = 1; i < pts.length; i++) if (len[i] > len[end]) end = i;
  const keep = new Set<number>();
  for (let i = pts.length ? end : -1; i >= 0; i = prev[i]) keep.add(i);
  const good = pts.filter((_, i) => keep.has(i));
  const inconsistent = pts.filter((_, i) => !keep.has(i));

  const unitCounts = new Map<string, number>();
  for (const x of all) if (x.r.odometerUnit) unitCounts.set(x.r.odometerUnit, (unitCounts.get(x.r.odometerUnit) ?? 0) + 1);
  const unit = ([...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as 'mi' | 'km' | undefined) ?? null;

  const first = good[0] ?? null, last = good[good.length - 1] ?? null;
  const days = first && last ? (last.time - first.time) / 86_400_000 : null;
  const distance = first && last && good.length >= 2 ? last.value - first.value : null;
  const rate = distance !== null && days !== null && days >= MIN_SPAN_DAYS ? distance / days : null;
  return {
    readings: all.length, timed: timed.length, untimed: all.length - timed.length, unit,
    first, last, inconsistent, distance, days,
    perDay: rate, perMonth: rate === null ? null : rate * 30.4375, perYear: rate === null ? null : rate * 365.25,
    averageDaysBetween: good.length >= 2 && days !== null ? days / (good.length - 1) : null,
    min: all.length ? Math.min(...all.map((x) => x.v)) : null,
    max: all.length ? Math.max(...all.map((x) => x.v)) : null,
  };
}
