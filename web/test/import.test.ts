import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importCsv, parseCsv, dedupeRecords, IMPORT_LIMITS } from '../src/services/ImportService.ts';
import { recordsToCsv } from '../src/services/ExportService.ts';
import { computeTrips } from '../src/services/TripService.ts';
import { newRecord } from '../src/services/RecordService.ts';
import type { FuelRecord } from '../src/models/FuelRecord.ts';

let n = 0;
const id = () => `i${++n}`;
const field = (v: number) => ({ detected: v, detectedText: String(v), confidence: 1, corrected: null, box: null, source: 'detected' as const }) as never;
function pump(at: string, volume: number, amount: number): FuelRecord {
  const r = newRecord(`p${++n}`, `pump${n}.jpg`, 1);
  return { ...r, kind: 'fuel_pump', status: 'confirmed', capturedAt: at, capturedSource: 'exif', volume: field(volume), amount: field(amount) };
}
function odo(at: string, value: number): FuelRecord {
  const r = newRecord(`o${++n}`, `odo${n}.jpg`, 1);
  return { ...r, kind: 'odometer', status: 'confirmed', capturedAt: at, capturedSource: 'exif', odometer: field(value), odometerUnit: 'mi' };
}

test('parser handles quotes, BOM, CRLF and embedded commas', () => {
  const rows = parseCsv('﻿a,b\r\n"x,1","say ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'say "hi"']]);
});

test('export then import gives the same values, without photos', () => {
  const src = [pump('2026-10-01T10:00:00-08:00', 12, 40), odo('2026-10-01T10:05:00-08:00', 10000)];
  const csv = recordsToCsv(src);
  const res = importCsv(csv, id);
  assert.equal(res.error, null);
  assert.equal(res.records.length, 2);
  const p = res.records.find((r) => r.kind === 'fuel_pump')!;
  assert.equal(p.imported, true);
  assert.equal(p.volume.detected, 12);
  assert.equal(p.capturedAt, '2026-10-01T10:00:00-08:00');
  assert.equal(recordsToCsv(res.records).split('\n').length, csv.split('\n').length);
});

test('imported history pairs with new photos across the month boundary', () => {
  const old = importCsv(recordsToCsv([pump('2026-10-01T10:00:00-08:00', 12, 40), odo('2026-10-01T10:05:00-08:00', 10000)]), id).records;
  const s = computeTrips([...old, pump('2026-11-01T10:00:00-08:00', 10, 35), odo('2026-11-01T10:04:00-08:00', 10300)]);
  assert.equal(s.trips.length, 1);
  assert.equal(s.trips[0].distance, 300);
});

test('importing the same data twice does not duplicate rows', () => {
  const csv = recordsToCsv([pump('2026-10-01T10:00:00-08:00', 12, 40)]);
  const a = importCsv(csv, id).records, b = importCsv(csv, id).records;
  assert.equal(dedupeRecords([...a, ...b]).length, 1);
});

test('bad input is rejected or skipped with a reason', () => {
  assert.ok(importCsv('hello\nworld', id).error);
  assert.ok(importCsv('x'.repeat(10), id).error);
  const csv = 'file_name,kind,captured_at,fuel_volume,amount\na.jpg,fuel_pump,not-a-date,10,20\nb.jpg,fuel_pump,2026-10-01T10:00:00-08:00,99999,20\nc.jpg,fuel_pump,2026-10-01T10:00:00-08:00,10,20\n';
  const res = importCsv(csv, id);
  assert.equal(res.records.length, 1);
  assert.equal(res.skipped.length, 2);
});

test('formula guard is removed and limits exist', () => {
  const csv = "file_name,kind,fuel_volume\n'=cmd.jpg,fuel_pump,10\n";
  const res = importCsv(csv, id);
  assert.equal(res.records[0]?.fileName, '=cmd.jpg');
  assert.ok(IMPORT_LIMITS.maxRows > 0 && IMPORT_LIMITS.maxBytes > 0);
});

test('full_tank = no survives the round trip', () => {
  const p = pump('2026-10-01T10:00:00-08:00', 5, 17); p.fullTank = false;
  const res = importCsv(recordsToCsv([p]), id);
  assert.equal(res.records[0].fullTank, false);
});
