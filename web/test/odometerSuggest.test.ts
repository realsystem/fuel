import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestOdometerFixes } from '../src/services/OdometerSuggestService.ts';
import { newRecord } from '../src/services/RecordService.ts';
import type { FuelRecord } from '../src/models/FuelRecord.ts';

let n = 0;
const odo = (day: string, value: number, status: FuelRecord['status'] = 'confirmed'): FuelRecord => {
  const r = newRecord(`o${++n}`, `o${n}.jpg`, 1);
  const f = { detected: value, detectedText: String(value), confidence: 1, corrected: null, box: null, source: 'detected' as const } as never;
  return { ...r, kind: 'odometer', status, capturedAt: `2026-${day}T10:00:00-08:00`, capturedSource: 'exif', odometer: f, odometerUnit: 'mi' };
};

test('a single misread digit between two good readings gets one suggestion', () => {
  const s = suggestOdometerFixes([odo('10-01', 10740), odo('10-10', 10711, 'review'), odo('10-20', 10790)]);
  assert.equal(s.length, 1);
  assert.equal(s[0].read, 10711);
  assert.equal(s[0].suggested, 10771);
  assert.equal(s[0].before, 10740);
  assert.equal(s[0].after, 10790);
});

test('consistent readings get no suggestion', () => {
  assert.deepEqual(suggestOdometerFixes([odo('10-01', 10740), odo('10-10', 10771), odo('10-20', 10790)]), []);
});

test('nothing is suggested when no single digit fixes it', () => {
  assert.deepEqual(suggestOdometerFixes([odo('10-01', 10740), odo('10-10', 99999, 'review'), odo('10-20', 10790)]), []);
});

test('photos with only a file date are ignored', () => {
  const a = odo('10-01', 10740), b = odo('10-10', 10711, 'review');
  b.capturedSource = 'file';
  assert.deepEqual(suggestOdometerFixes([a, b, odo('10-20', 10790)]), []);
});
