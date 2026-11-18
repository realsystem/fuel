/**
 * Fuel economy from photos: pairs each fill-up (pump photo) with the odometer
 * photo taken closest in time, then works out distance, efficiency and cost
 * between consecutive fill-ups.
 *
 * Every number is cross-checked and anything that looks impossible is marked
 * "check" and left out of the averages, so one missed fill-up or one misread
 * digit cannot quietly corrupt the totals.
 *
 * Method (stated, not hidden): efficiency = distance since the previous
 * fill-up / volume of this fill-up. That is only right if each fill-up filled
 * the tank to the same level (the usual "full-to-full" method); a partial
 * fill makes one trip too good and the next too bad, which is why efficiency
 * outside a plausible range is flagged.
 */
import { effectiveValue, type FuelRecord } from '../models/FuelRecord.ts';

export interface TripConfig {
  /** An odometer photo further than this from a pump photo is not paired with it. */
  maxPairGapHours: number;
  /** More than this between two fill-ups probably means a missed fill-up. */
  maxDistance: number;
  /** Plausible distance per fuel unit (mpg-like). Outside this the trip is flagged. */
  minEfficiency: number;
  maxEfficiency: number;
  /** Plausible price per distance unit (cost per mile). */
  maxCostPerDistance: number;
}

export const TRIP_CONFIG: TripConfig = {
  maxPairGapHours: 6,
  maxDistance: 1200,
  minEfficiency: 5,
  maxEfficiency: 80,
  maxCostPerDistance: 3,
};

export interface FillUp {
  recordId: string;
  fileName: string;
  odometerRecordId: string;
  odometerFileName: string;
  /** Milliseconds since epoch (capture time, with its UTC offset when known). */
  time: number;
  date: string;
  volume: number;
  amount: number;
  odometer: number;
  unit: 'mi' | 'km' | null;
  /** Minutes between the pump photo and the odometer photo. */
  pairGapMinutes: number;
  /** The tank was filled to the same level as before. Partial fills are rolled into the next full one. */
  fullTank: boolean;
  /** True when any record behind this fill-up is not confirmed yet. */
  provisional: boolean;
}

export type TripIssue =
  | 'odometer_not_increasing'
  | 'distance_very_large'
  | 'efficiency_implausible'
  | 'cost_implausible'
  | 'units_differ';

export interface Trip {
  from: FillUp;
  to: FillUp;
  /** Fill-ups after `from`, up to and including `to` (partial fills first). All their fuel is counted. */
  fills: FillUp[];
  distance: number;
  /** Fuel bought since `from` (full-to-full method: every fill after the previous full one). */
  volume: number;
  amount: number;
  days: number;
  efficiency: number | null;
  costPerDistance: number | null;
  unit: 'mi' | 'km' | null;
  issues: TripIssue[];
  provisional: boolean;
}

/** One line per fill-up photo pair, plus pump photos and odometer photos that found no partner. */
export interface FillUpRow {
  kind: 'fill_up' | 'pump_only' | 'odometer_only';
  recordId: string;
  odometerRecordId: string | null;
  fileName: string;
  date: string | null;
  time: number | null;
  odometer: number | null;
  volume: number | null;
  amount: number | null;
  unitPrice: number | null;
  fullTank: boolean | null;
  fillUp: FillUp | null;
  /** The trip that ended at this fill-up. */
  trip: Trip | null;
  /** 'first' = start point; 'partial' = rolled into the next full fill-up; 'pending' = after the last full one. */
  role: 'first' | 'trip_end' | 'partial' | 'pending' | null;
  /** Why this row is not paired, for pump_only / odometer_only rows. */
  problem: 'no_odometer_nearby' | 'no_capture_time' | 'no_pump_nearby' | null;
}

export interface TripSummary {
  fillUps: FillUp[];
  /** Rows for a table: every fill-up in time order, then the unpaired photos. */
  rows: FillUpRow[];
  trips: Trip[];
  /** Pump photos that have a volume and amount but no odometer photo close enough in time. */
  unpairedFillUps: Array<{ recordId: string; fileName: string; reason: 'no_capture_time' | 'no_odometer_nearby' }>;
  /** Odometer readings that no fill-up was paired with. */
  unpairedOdometers: Array<{ recordId: string; fileName: string }>;
  /** Totals over the trips with no issues. */
  totals: {
    trips: number;
    distance: number;
    volume: number;
    amount: number;
    efficiency: number | null;
    costPerDistance: number | null;
    averageDaysBetween: number | null;
  };
  flaggedTrips: number;
}

/** Epoch ms from an EXIF local time ("2026-11-17T10:46:36") and optional offset ("-08:00"). */
export function captureTimeMs(local: string, offsetHint?: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(local + (offsetHint ?? ''));
  if (!m) return null;
  const utcLike = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (!m[7] || m[7] === 'Z') return utcLike;
  const sign = m[7][0] === '-' ? -1 : 1;
  const mins = Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6));
  return utcLike - sign * mins * 60_000;
}

const usableStatus = (r: FuelRecord) => r.status === 'confirmed' || r.status === 'detected';

function timeOf(r: FuelRecord): number | null {
  // A file's modified date says when the file was saved, not when the photo was taken.
  if (!r.capturedAt || r.capturedSource !== 'exif') return null;
  const m = /^(.*?)([+-]\d{2}:\d{2}|Z)?$/.exec(r.capturedAt);
  return m ? captureTimeMs(m[1], m[2] ?? null) : null;
}

export function computeTrips(records: FuelRecord[], cfg: TripConfig = TRIP_CONFIG): TripSummary {
  const pumps: Array<{ r: FuelRecord; t: number | null; volume: number; amount: number }> = [];
  const odos: Array<{ r: FuelRecord; t: number | null; value: number }> = [];
  for (const r of records) {
    if (!usableStatus(r)) continue;
    if (r.kind === 'odometer') {
      const v = effectiveValue(r.odometer);
      if (v !== null && v > 0) odos.push({ r, t: timeOf(r), value: v });
    } else if (r.kind === 'fuel_pump') {
      const volume = effectiveValue(r.volume), amount = effectiveValue(r.amount);
      if (volume !== null && amount !== null && volume > 0 && amount > 0) pumps.push({ r, t: timeOf(r), volume, amount });
    }
  }

  // Pair by smallest time gap first; each photo is used once.
  const candidates: Array<{ p: number; o: number; gap: number }> = [];
  pumps.forEach((p, pi) => odos.forEach((o, oi) => {
    if (p.t === null || o.t === null) return;
    const gap = Math.abs(p.t - o.t);
    if (gap <= cfg.maxPairGapHours * 3_600_000) candidates.push({ p: pi, o: oi, gap });
  }));
  candidates.sort((a, b) => a.gap - b.gap);
  const pumpUsed = new Set<number>(), odoUsed = new Set<number>();
  const fillUps: FillUp[] = [];
  for (const c of candidates) {
    if (pumpUsed.has(c.p) || odoUsed.has(c.o)) continue;
    pumpUsed.add(c.p); odoUsed.add(c.o);
    const p = pumps[c.p], o = odos[c.o];
    fillUps.push({
      recordId: p.r.id, fileName: p.r.fileName, odometerRecordId: o.r.id, odometerFileName: o.r.fileName,
      time: p.t!, date: new Date(p.t!).toISOString().slice(0, 10),
      volume: p.volume, amount: p.amount, odometer: o.value, unit: o.r.odometerUnit,
      pairGapMinutes: Math.round(c.gap / 60_000),
      fullTank: p.r.fullTank,
      provisional: p.r.status !== 'confirmed' || o.r.status !== 'confirmed',
    });
  }
  fillUps.sort((a, b) => a.time - b.time);

  // Full-to-full: a trip runs from one full fill-up to the next. Partial fills in between add their
  // fuel to the trip but are not endpoints.
  const trips: Trip[] = [];
  let anchor: FillUp | null = null;
  let between: FillUp[] = [];
  for (const f of fillUps) {
    if (!anchor) { if (f.fullTank) anchor = f; continue; }
    between.push(f);
    if (!f.fullTank) continue;
    const from = anchor, to = f;
    const issues: TripIssue[] = [];
    const distance = to.odometer - from.odometer;
    if (from.unit && to.unit && from.unit !== to.unit) issues.push('units_differ');
    if (distance <= 0) issues.push('odometer_not_increasing');
    if (distance > cfg.maxDistance) issues.push('distance_very_large');
    const volume = between.reduce((s2, x) => s2 + x.volume, 0);
    const amount = between.reduce((s2, x) => s2 + x.amount, 0);
    const efficiency = distance > 0 ? distance / volume : null;
    if (efficiency !== null && (efficiency < cfg.minEfficiency || efficiency > cfg.maxEfficiency)) issues.push('efficiency_implausible');
    const costPerDistance = distance > 0 ? amount / distance : null;
    if (costPerDistance !== null && costPerDistance > cfg.maxCostPerDistance) issues.push('cost_implausible');
    trips.push({
      from, to, fills: between, distance, volume, amount, days: (to.time - from.time) / 86_400_000,
      efficiency, costPerDistance, unit: to.unit ?? from.unit, issues,
      provisional: from.provisional || between.some((x) => x.provisional),
    });
    anchor = to;
    between = [];
  }

  const good = trips.filter((t) => t.issues.length === 0);
  const distance = good.reduce((s, t) => s + t.distance, 0);
  const volume = good.reduce((s, t) => s + t.volume, 0);
  const amount = good.reduce((s, t) => s + t.amount, 0);
  const days = good.reduce((s, t) => s + t.days, 0);

  const pumpIds = new Set(pumps.filter((_, i) => pumpUsed.has(i)).map((p) => p.r.id));
  const odoIds = new Set(odos.filter((_, i) => odoUsed.has(i)).map((o) => o.r.id));
  // Rows for the table.
  const tripEndingAt = new Map(trips.map((t) => [t.to.recordId, t]));
  const firstFull = fillUps.find((f) => f.fullTank) ?? null;
  const lastFull = [...fillUps].reverse().find((f) => f.fullTank) ?? null;
  const rows: FillUpRow[] = fillUps.map((f) => {
    const pr = records.find((r) => r.id === f.recordId);
    const up = pr ? effectiveValue(pr.unitPrice) : null;
    const role: FillUpRow['role'] = f === firstFull ? 'first'
      : tripEndingAt.has(f.recordId) ? 'trip_end'
      : lastFull && f.time > lastFull.time ? 'pending'
      : !firstFull || f.time < firstFull.time ? 'pending' : 'partial';
    return {
      kind: 'fill_up', recordId: f.recordId, odometerRecordId: f.odometerRecordId, fileName: f.fileName,
      date: f.date, time: f.time, odometer: f.odometer, volume: f.volume, amount: f.amount,
      unitPrice: up ?? (f.volume > 0 ? f.amount / f.volume : null), fullTank: f.fullTank, fillUp: f,
      trip: tripEndingAt.get(f.recordId) ?? null, role, problem: null,
    };
  });
  for (const p of pumps) {
    if (pumpIds.has(p.r.id)) continue;
    const up = effectiveValue(p.r.unitPrice);
    rows.push({
      kind: 'pump_only', recordId: p.r.id, odometerRecordId: null, fileName: p.r.fileName,
      date: p.t === null ? null : new Date(p.t).toISOString().slice(0, 10), time: p.t, odometer: null,
      volume: p.volume, amount: p.amount, unitPrice: up ?? p.amount / p.volume, fullTank: p.r.fullTank,
      fillUp: null, trip: null, role: null, problem: p.t === null ? 'no_capture_time' : 'no_odometer_nearby',
    });
  }
  for (const o of odos) {
    if (odoIds.has(o.r.id)) continue;
    rows.push({
      kind: 'odometer_only', recordId: o.r.id, odometerRecordId: o.r.id, fileName: o.r.fileName,
      date: o.t === null ? null : new Date(o.t).toISOString().slice(0, 10), time: o.t, odometer: o.value,
      volume: null, amount: null, unitPrice: null, fullTank: null, fillUp: null, trip: null, role: null,
      problem: o.t === null ? 'no_capture_time' : 'no_pump_nearby',
    });
  }
  return {
    fillUps,
    rows,
    trips,
    unpairedFillUps: pumps.filter((p) => !pumpIds.has(p.r.id)).map((p) => ({
      recordId: p.r.id, fileName: p.r.fileName, reason: p.t === null ? 'no_capture_time' as const : 'no_odometer_nearby' as const,
    })),
    unpairedOdometers: odos.filter((o) => !odoIds.has(o.r.id)).map((o) => ({ recordId: o.r.id, fileName: o.r.fileName })),
    totals: {
      trips: good.length, distance, volume, amount,
      efficiency: volume > 0 ? distance / volume : null,
      costPerDistance: distance > 0 ? amount / distance : null,
      averageDaysBetween: good.length ? days / good.length : null,
    },
    flaggedTrips: trips.length - good.length,
  };
}

export const ISSUE_TEXT: Record<TripIssue, string> = {
  odometer_not_increasing: 'The odometer did not go up. One of the two readings is probably wrong.',
  distance_very_large: 'Very long distance between fill-ups: a fill-up may be missing from the photos.',
  efficiency_implausible: 'Efficiency is outside the plausible range: a fill-up may be missing, partial, or misread.',
  cost_implausible: 'Cost per distance is implausibly high: check the amount and the odometer.',
  units_differ: 'The two odometer photos show different units (mi and km).',
};

export const TRIP_CSV_COLUMNS = [
  'from_date', 'to_date', 'from_odometer', 'to_odometer', 'distance', 'distance_unit', 'fuel_volume', 'amount',
  'efficiency', 'cost_per_distance', 'days', 'status', 'issues', 'from_pump_photo', 'to_pump_photo', 'from_odometer_photo', 'to_odometer_photo',
] as const;

export function tripsToCsv(summary: TripSummary): string {
  const q = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const cell = (v: string) => { const s = q(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [TRIP_CSV_COLUMNS.join(',')];
  for (const t of summary.trips) {
    rows.push([
      t.from.date, t.to.date, String(t.from.odometer), String(t.to.odometer), String(t.distance), t.unit ?? '',
      t.volume.toFixed(3), t.amount.toFixed(2),
      t.efficiency === null ? '' : t.efficiency.toFixed(2), t.costPerDistance === null ? '' : t.costPerDistance.toFixed(3),
      t.days.toFixed(1), t.issues.length ? 'check' : t.provisional ? 'provisional' : 'ok', t.issues.join(' '),
      t.from.fileName, t.to.fileName, t.from.odometerFileName, t.to.odometerFileName,
    ].map(cell).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
