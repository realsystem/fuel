import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualFillUp } from '../src/services/ManualEntryService.ts';
import { computeTrips } from '../src/services/TripService.ts';
import { importCsv } from '../src/services/ImportService.ts';
import { recordsToCsv } from '../src/services/ExportService.ts';

let n = 0;
const id = () => `m${++n}`;
const entry = (date: string, odometer: string, volume: string, amount: string) => ({ date, odometer, unit: 'mi' as const, volume, amount, fullTank: true });
const NOW = new Date('2026-11-18T12:00:00-08:00');

test('typed fill-ups pair and give a trip', () => {
  const a = manualFillUp(entry('2026-10-01', '10000', '12', '40'), id, NOW);
  const b = manualFillUp({ ...entry('2026-10-20', '10300', '10', '35'), tag: 'towing' }, id, NOW);
  assert.ok(a.ok && b.ok);
  const s = computeTrips([...(a.ok ? a.records : []), ...(b.ok ? b.records : [])]);
  assert.equal(s.trips.length, 1);
  assert.equal(s.trips[0].distance, 300);
  assert.equal(s.trips[0].to.tag, 'towing');
});

test('typed fill-ups survive export and import', () => {
  const a = manualFillUp(entry('2026-10-01', '10000', '12.5', '40'), id, NOW);
  assert.ok(a.ok);
  const back = importCsv(recordsToCsv(a.ok ? a.records : []), id);
  assert.equal(back.records.length, 2);
});

test('bad entries are refused with a reason', () => {
  for (const e of [entry('', '10000', '12', '40'), entry('2026-10-01', '10k', '12', '40'), entry('2026-10-01', '10000', '0', '40'), entry('2026-10-01', '10000', '12', 'abc'), entry('2027-01-01', '10000', '12', '40')]) {
    const r = manualFillUp(e, id, NOW);
    assert.equal(r.ok, false, JSON.stringify(e));
  }
});
