import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureTimeMs, computeTrips, tripsToCsv } from '../src/services/TripService.ts';
import { newRecord } from '../src/services/RecordService.ts';
import type { FuelRecord } from '../src/models/FuelRecord.ts';

let n = 0;
const field = (v: number) => ({ detected: v, detectedText: String(v), confidence: 1, corrected: null, box: null, source: 'detected' as const }) as never;
function pump(at: string, volume: number, amount: number, status: FuelRecord['status'] = 'confirmed', src: 'exif' | 'file' = 'exif'): FuelRecord {
  const r = newRecord(`p${++n}`, `pump${n}.jpg`, 1);
  return { ...r, kind: 'fuel_pump', status, capturedAt: at, capturedSource: src, volume: field(volume), amount: field(amount) };
}
function odo(at: string, value: number, unit: 'mi' | 'km' | null = 'mi', status: FuelRecord['status'] = 'confirmed'): FuelRecord {
  const r = newRecord(`o${++n}`, `odo${n}.jpg`, 1);
  return { ...r, kind: 'odometer', status, capturedAt: at, capturedSource: 'exif', odometer: field(value), odometerUnit: unit };
}
const T = (d: string, h = '10:00:00') => `2026-${d}T${h}-08:00`;

test('capture times honour the UTC offset', () => {
  assert.equal(captureTimeMs('2026-11-17T10:00:00', '-08:00'), Date.UTC(2026, 10, 17, 18, 0, 0));
  assert.equal(captureTimeMs('nope'), null);
});

test('pairs by time, then computes distance, efficiency and cost between fill-ups', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-01', '10:05:00'), 10000),
    pump(T('10-15'), 10, 35), odo(T('10-15', '09:50:00'), 10300),
    pump(T('11-01'), 11, 38.5), odo(T('11-01', '10:03:00'), 10638),
  ]);
  assert.equal(s.fillUps.length, 3);
  assert.equal(s.trips.length, 2);
  assert.equal(s.trips[0].distance, 300);
  assert.ok(Math.abs(s.trips[0].efficiency! - 30) < 1e-9);
  assert.ok(Math.abs(s.trips[0].costPerDistance! - 35 / 300) < 1e-9);
  assert.equal(s.flaggedTrips, 0);
  assert.equal(s.totals.distance, 638);
  assert.ok(Math.abs(s.totals.efficiency! - 638 / 21) < 1e-9);
});

test('a missed fill-up shows up as an implausible trip and stays out of the averages', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-01', '10:05:00'), 10000),
    pump(T('10-20'), 3, 10), odo(T('10-20', '10:05:00'), 10500), // 500 mi on 3 gal
    pump(T('11-02'), 10, 35), odo(T('11-02', '10:05:00'), 10800),
  ]);
  assert.deepEqual(s.trips[0].issues, ['efficiency_implausible']);
  assert.equal(s.trips[1].issues.length, 0);
  assert.equal(s.totals.trips, 1);
  assert.equal(s.totals.distance, 300);
});

test('an odometer that goes down is flagged, not averaged', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-01'), 10000),
    pump(T('10-15'), 10, 35), odo(T('10-15'), 9300),
  ]);
  assert.ok(s.trips[0].issues.includes('odometer_not_increasing'));
  assert.equal(s.trips[0].efficiency, null);
  assert.equal(s.totals.efficiency, null);
});

test('photos far apart in time are not paired; unpaired ones are listed', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-03'), 10000),
    pump(T('10-05', '10:00:00'), 10, 30, 'confirmed', 'file'),
  ]);
  assert.equal(s.fillUps.length, 0);
  assert.equal(s.unpairedFillUps.length, 2);
  assert.equal(s.unpairedFillUps.find((u) => u.reason === 'no_capture_time') !== undefined, true);
  assert.equal(s.unpairedOdometers.length, 1);
});

test('each odometer photo is used once, by the nearest pump photo', () => {
  const a = pump(T('10-01', '10:00:00'), 10, 30), b = pump(T('10-01', '10:20:00'), 10, 30);
  const s = computeTrips([a, b, odo(T('10-01', '10:18:00'), 5000)]);
  assert.equal(s.fillUps.length, 1);
  assert.equal(s.fillUps[0].recordId, b.id);
  assert.equal(s.unpairedFillUps[0].recordId, a.id);
});

test('records that still need review are not used; unconfirmed ones make a trip provisional', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40, 'review'), odo(T('10-01'), 10000),
    pump(T('10-15'), 10, 35, 'detected'), odo(T('10-15'), 10300),
    pump(T('11-01'), 10, 35), odo(T('11-01'), 10600),
  ]);
  assert.equal(s.fillUps.length, 2);
  assert.equal(s.trips[0].provisional, true);
});

test('mixed units are flagged; CSV neutralises formulas and lists status', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-01'), 10000, 'mi'),
    pump(T('10-15'), 10, 35), odo(T('10-15'), 10300, 'km'),
  ]);
  assert.ok(s.trips[0].issues.includes('units_differ'));
  const csv = tripsToCsv(s).split('\r\n');
  assert.match(csv[0], /^from_date,to_date,/);
  assert.match(csv[1], /,check,units_differ,/);
});

test('partial fills are rolled into the next full fill-up', () => {
  const part = pump(T('10-10'), 5, 17);
  part.fullTank = false;
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-01', '10:05:00'), 10000),
    part, odo(T('10-10', '10:02:00'), 10150),
    pump(T('10-20'), 5, 18), odo(T('10-20', '10:02:00'), 10300),
  ]);
  assert.equal(s.fillUps.length, 3);
  assert.equal(s.trips.length, 1);
  assert.equal(s.trips[0].distance, 300);
  assert.equal(s.trips[0].volume, 10);
  assert.equal(s.trips[0].amount, 35);
  assert.ok(Math.abs(s.trips[0].efficiency! - 30) < 1e-9);
  assert.deepEqual(s.rows.map((r) => r.role), ['first', 'partial', 'trip_end']);
});

test('rows list fill-ups, then pump and odometer photos that found no partner', () => {
  const s = computeTrips([
    pump(T('10-01'), 12, 40), odo(T('10-01', '10:05:00'), 10000),
    pump(T('10-05'), 8, 30),
    odo(T('10-09'), 10200),
  ]);
  assert.deepEqual(s.rows.map((r) => r.kind), ['fill_up', 'pump_only', 'odometer_only']);
  assert.equal(s.rows[1].problem, 'no_odometer_nearby');
  assert.equal(s.rows[2].problem, 'no_pump_nearby');
});
