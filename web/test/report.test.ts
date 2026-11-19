import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, tripTag } from '../src/services/ReportService.ts';
import { computeTrips } from '../src/services/TripService.ts';
import { newRecord } from '../src/services/RecordService.ts';
import type { FuelRecord } from '../src/models/FuelRecord.ts';

let n = 0;
const field = (v: number) => ({ detected: v, detectedText: String(v), confidence: 1, corrected: null, box: null, source: 'detected' as const }) as never;
const fill = (day: string, vol: number, amt: number, odo: number, tag = ''): FuelRecord[] => {
  const p = newRecord(`p${++n}`, `p${n}.jpg`, 1);
  const o = newRecord(`o${++n}`, `o${n}.jpg`, 1);
  const at = `2026-${day}T10:00:00-08:00`;
  return [
    { ...p, kind: 'fuel_pump', status: 'confirmed', capturedAt: at, capturedSource: 'exif', volume: field(vol), amount: field(amt), tag },
    { ...o, kind: 'odometer', status: 'confirmed', capturedAt: `2026-${day}T10:03:00-08:00`, capturedSource: 'exif', odometer: field(odo), odometerUnit: 'mi' },
  ];
};

test('months, tags, best and worst trips', () => {
  const s = computeTrips([
    ...fill('09-20', 10, 30, 10000),
    ...fill('10-05', 10, 32, 10300, 'towing'),   // 30 mpg
    ...fill('10-25', 10, 33, 10500, 'highway'),  // 20 mpg
    ...fill('11-10', 10, 35, 10800, 'highway'),  // 30 mpg
  ]);
  const r = buildReport(s);
  assert.equal(r.fillUps, 4);
  assert.equal(r.trips, 3);
  assert.equal(r.distance, 800);
  assert.deepEqual(r.months.map((m) => m.key), ['2026-09', '2026-10', '2026-11']);
  assert.equal(r.months[1].trips, 2);
  const hw = r.tags.find((t) => t.key === 'highway')!;
  assert.equal(hw.trips, 2);
  assert.ok(Math.abs(hw.efficiency! - 500 / 20) < 1e-9);
  assert.equal(r.worst?.efficiency, 20);
  assert.equal(r.efficiencySeries.length, 3);
  assert.equal(tripTag(s.trips[0]), 'towing');
});

test('an empty summary gives an empty report', () => {
  const r = buildReport(computeTrips([]));
  assert.equal(r.fillUps, 0);
  assert.equal(r.efficiency, null);
  assert.deepEqual(r.months, []);
});
