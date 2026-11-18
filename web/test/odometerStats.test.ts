import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOdometerStats } from '../src/services/OdometerStatsService.ts';
import { newRecord } from '../src/services/RecordService.ts';
import type { FuelRecord } from '../src/models/FuelRecord.ts';

let n = 0;
function odo(at: string | null, value: number, status: FuelRecord['status'] = 'detected', src: 'exif' | 'file' = 'exif'): FuelRecord {
  const r = newRecord(`o${++n}`, `o${n}.jpg`, 1);
  return { ...r, kind: 'odometer', status, capturedAt: at, capturedSource: at ? src : null, odometerUnit: 'mi',
    odometer: { detected: value, detectedText: String(value), confidence: 1, corrected: null, box: null } as never };
}
const D = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00-08:00`;

test('distance, span and rates from readings alone', () => {
  const s = computeOdometerStats([odo(D(1, 1), 10000), odo(D(3, 2), 12000), odo(D(5, 1), 14000)]);
  assert.equal(s.readings, 3);
  assert.equal(s.distance, 4000);
  assert.equal(s.days, 120);
  assert.ok(Math.abs(s.perDay! - 4000 / 120) < 1e-9);
  assert.ok(Math.abs(s.perYear! - (4000 / 120) * 365.25) < 1e-6);
  assert.equal(s.averageDaysBetween, 60);
  assert.equal(s.unit, 'mi');
});

test('order comes from photo time, not file order', () => {
  const s = computeOdometerStats([odo(D(5, 1), 14000), odo(D(1, 1), 10000)]);
  assert.equal(s.first?.value, 10000);
  assert.equal(s.last?.value, 14000);
});

test('a reading lower than an earlier one is flagged and left out', () => {
  const s = computeOdometerStats([odo(D(1, 1), 10000), odo(D(2, 1), 10900), odo(D(3, 1), 1100), odo(D(4, 1), 12000)]);
  assert.deepEqual(s.inconsistent.map((p) => p.value), [1100]);
  assert.equal(s.distance, 2000);
});

test('a misread high value followed by normal readings is dropped, not trusted', () => {
  const s = computeOdometerStats([odo(D(1, 1), 10000), odo(D(2, 1), 90500), odo(D(3, 1), 10900), odo(D(4, 1), 11500)]);
  assert.equal(s.last?.value, 11500);
  assert.equal(s.distance, 1500);
});

test('one reading, or all on the same day, gives no rate', () => {
  assert.equal(computeOdometerStats([odo(D(1, 1), 10000)]).distance, null);
  const same = computeOdometerStats([odo(D(1, 1), 10000), odo('2026-01-01T18:00:00-08:00', 10050)]);
  assert.equal(same.distance, 50);
  assert.equal(same.perDay, null);
});

test('photos with only a file date are counted but not used for rates; review ones are ignored', () => {
  const s = computeOdometerStats([odo(D(1, 1), 10000), odo(D(2, 1), 11000), odo(null, 12000), odo(D(3, 1), 13000, 'review'), odo(D(4, 1), 14000, 'detected', 'file')]);
  assert.equal(s.readings, 4);
  assert.equal(s.timed, 2);
  assert.equal(s.untimed, 2);
  assert.equal(s.distance, 1000);
  assert.equal(s.max, 14000);
});
