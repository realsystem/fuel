import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateImageFile } from '../src/utils/imageValidation.ts';
import { decimalPlaces, formatFixed, parseNumber } from '../src/utils/numberFormatting.ts';
import { applyResult, canConfirm, confirmRecord, correctField, newRecord } from '../src/services/RecordService.ts';
import { computeStatistics } from '../src/services/StatisticsService.ts';
import { CSV_COLUMNS, csvCell, recordsToCsv } from '../src/services/ExportService.ts';
import { effectiveValue, type FuelRecord } from '../src/models/FuelRecord.ts';
import type { ProcessingResult } from '../src/models/ProcessingResult.ts';

// --- validation ---

test('accepts JPEG, PNG, WebP within the size limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validateImageFile({ name: 'a', size: 1000, type }), null);
  }
});

test('rejects other types, empty and oversized files', () => {
  assert.equal(validateImageFile({ name: 'a.gif', size: 10, type: 'image/gif' })?.code, 'unsupported_type');
  assert.equal(validateImageFile({ name: 'a.txt', size: 10, type: 'text/plain' })?.code, 'unsupported_type');
  assert.equal(validateImageFile({ name: 'a.jpg', size: 0, type: 'image/jpeg' })?.code, 'decode_failed');
  assert.equal(validateImageFile({ name: 'a.jpg', size: 20e6, type: 'image/jpeg' }, { maxBytes: 15e6 })?.code, 'too_large');
});

test('falls back to the extension when the browser gives no type', () => {
  assert.equal(validateImageFile({ name: 'PUMP.JPG', size: 10, type: '' }), null);
  assert.equal(validateImageFile({ name: 'pump.heic', size: 10, type: '' })?.code, 'unsupported_type');
});

// --- number parsing ---

test('parseNumber handles common user input', () => {
  assert.equal(parseNumber('24.07'), 24.07);
  assert.equal(parseNumber(' 24,07 '), 24.07);
  assert.equal(parseNumber('$1,234.50'), 1234.5);
  assert.equal(parseNumber('1.234,50'), 1234.5);
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('-3'), null);
  assert.equal(parseNumber('1.2.3'), null);
});

test('formatFixed and decimalPlaces', () => {
  assert.equal(formatFixed(20, 2), '20.00');
  assert.equal(formatFixed(null, 2), '');
  assert.equal(decimalPlaces('6.362'), 3);
  assert.equal(decimalPlaces('18'), 0);
});

// --- records ---

function result(amount: number | null, volume: number | null, status: ProcessingResult['status'] = 'ok'): ProcessingResult {
  const values = [];
  const fields: ProcessingResult['fields'] = {};
  if (amount !== null) { values.push({ id: 'v0', text: amount.toFixed(2), value: amount, confidence: 0.98, box: null, field: 'amount', fieldConfidence: 0.95, decimalInferred: false, ambiguousDigits: [] }); fields.amount = 'v0'; }
  if (volume !== null) { values.push({ id: 'v1', text: volume.toFixed(3), value: volume, confidence: 0.98, box: null, field: 'volume', fieldConfidence: 0.95, decimalInferred: false, ambiguousDigits: [] }); fields.volume = 'v1'; }
  return { schemaVersion: 1, processor: 'test', subject: 'fuel_pump', imageName: 'x.jpg', imageSize: null, status, values, fields, warnings: [], processedAt: '2026-10-30T00:00:00.000Z', durationMs: 1 };
}

function record(id: string, amount: number | null, volume: number | null, status: ProcessingResult['status'] = 'ok'): FuelRecord {
  return applyResult(newRecord(id, `${id}.jpg`, 1000), result(amount, volume, status));
}

test('applyResult derives unit price and sets status from the result', () => {
  const r = record('a', 40, 10);
  assert.equal(r.status, 'detected');
  assert.equal(r.unitPrice.derived, 4);
  assert.equal(record('b', 40, null, 'partial').status, 'review');
  assert.equal(applyResult(newRecord('c', 'c.jpg', 1), { ...result(null, null), status: 'error', error: { code: 'decode_failed', message: 'bad' } }).status, 'failed');
});

test('editing a field keeps the detected value and updates the derived price', () => {
  const r = correctField(record('a', 40, 10), 'amount', 45);
  assert.equal(r.amount.detected, 40);
  assert.equal(r.amount.corrected, 45);
  assert.equal(effectiveValue(r.amount), 45);
  assert.equal(r.unitPrice.derived, 4.5);
  const reverted = correctField(r, 'amount', null);
  assert.equal(effectiveValue(reverted.amount), 40);
});

test('editing a confirmed record sends it back to review', () => {
  const r = confirmRecord(record('a', 40, 10));
  assert.equal(r.status, 'confirmed');
  assert.equal(correctField(r, 'volume', 11).status, 'review');
});

test('a record without amount and volume cannot be confirmed', () => {
  assert.equal(confirmRecord(record('a', 40, null, 'partial')).status, 'review');
});

// --- statistics ---

test('statistics separate confirmed from provisional and skip review/failed', () => {
  const recs = [
    confirmRecord(record('a', 40, 10)),
    confirmRecord(record('b', 60, 20)),
    record('c', 30, 10),               // detected, unconfirmed
    record('d', 99, null, 'partial'),  // review
  ];
  const s = computeStatistics(recs);
  assert.equal(s.imagesProcessed, 4);
  assert.equal(s.successfulDetections, 3);
  assert.equal(s.needsReview, 1);
  assert.equal(s.confirmed.records, 2);
  assert.equal(s.confirmed.totalAmount, 100);
  assert.equal(s.confirmed.totalVolume, 30);
  assert.equal(s.confirmed.averageUnitPrice, 100 / 30);
  assert.equal(s.confirmed.averageVolume, 15);
  assert.equal(s.provisional.records, 3);
  assert.equal(s.provisional.totalAmount, 130);
});

test('statistics on nothing confirmed are empty, not NaN', () => {
  const s = computeStatistics([record('a', 40, 10)]);
  assert.equal(s.confirmed.records, 0);
  assert.equal(s.confirmed.averageUnitPrice, null);
  assert.equal(s.confirmed.averageVolume, null);
});

// --- CSV ---

test('CSV has a header, fixed decimals and correction flag', () => {
  const recs = [confirmRecord(record('a', 40, 10)), correctField(record('b', 20, 4.348), 'amount', 20.5)];
  const lines = recordsToCsv(recs).trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines[1], 'a.jpg,fuel_pump,,,10.000,40.00,4.000,derived,,,,ok,confirmed,no,2026-10-30T00:00:00.000Z');
  assert.match(lines[2], /^b\.jpg,fuel_pump,,,4\.348,20\.50,4\.715,derived,,,,ok,detected,yes,/);
});

test('CSV cells are quoted and protected against formula injection', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
});

test('CSV carries the capture time and where it came from', () => {
  const r = { ...record('c', 40, 10), capturedAt: '2025-12-05T19:39:07-08:00', capturedSource: 'exif' as const };
  assert.match(recordsToCsv([r]).split('\r\n')[1], /^c\.jpg,fuel_pump,2025-12-05T19:39:07-08:00,exif,10\.000,/);
});

test('support link accepts only plain https URLs', async () => {
  const { safeSupportUrl } = await import('../src/utils/supportUrl.ts');
  assert.equal(safeSupportUrl('https://buymeacoffee.com/someone'), 'https://buymeacoffee.com/someone');
  assert.equal(safeSupportUrl('buymeacoffee.com/example'), 'https://buymeacoffee.com/example');
  assert.equal(safeSupportUrl('  https://buymeacoffee.com/example  '), 'https://buymeacoffee.com/example');
  for (const bad of ['', undefined, 'javascript:alert(1)', 'http://example.com', 'data:text/html,x', 'https://localhost', 'not a url']) {
    assert.equal(safeSupportUrl(bad), null, String(bad));
  }
});

test('odometer results become odometer records with their own field, kept out of fuel statistics', async () => {
  const { computeStatistics } = await import('../src/services/StatisticsService.ts');
  const res: ProcessingResult = {
    schemaVersion: 1, processor: 't', subject: 'odometer', imageName: 'o.jpg', imageSize: { width: 1, height: 1 },
    status: 'ok', warnings: [], processedAt: '2026-10-30T00:00:00.000Z', durationMs: 1,
    values: [{ id: 'odo1', text: '53164', value: 53164, confidence: 0.99, box: null, field: 'odometer', fieldConfidence: 0.95, decimalInferred: false, ambiguousDigits: [] }],
    fields: { odometer: 'odo1' }, odometerUnit: 'mi',
  };
  const r = applyResult(newRecord('o', 'o.jpg', 1), res);
  assert.equal(r.kind, 'odometer');
  assert.equal(r.odometer.detected, 53164);
  assert.equal(r.odometerUnit, 'mi');
  assert.equal(canConfirm(r), true);
  const edited = correctField(r, 'odometer', 53165);
  assert.equal(effectiveValue(edited.odometer), 53165);
  assert.equal(edited.odometer.detected, 53164);
  assert.equal(computeStatistics([r]).imagesProcessed, 0);
  const csv = recordsToCsv([edited]).split('\r\n');
  assert.match(csv[1], /^o\.jpg,odometer,,,,,,missing,53165,mi,,ok,detected,yes,/);
});

test('photos that are neither a pump nor an odometer are kept apart', async () => {
  const res: ProcessingResult = {
    schemaVersion: 1, processor: 't', subject: 'unrecognized', imageName: 'f.jpg', imageSize: null, status: 'no_numbers',
    values: [], fields: {}, warnings: ['x'], error: { code: 'no_numbers', message: 'x' }, processedAt: '2026-10-30T00:00:00.000Z', durationMs: 1,
  };
  const r = applyResult(newRecord('f', 'f.jpg', 1), res);
  assert.equal(r.kind, 'unrecognized');
  assert.equal(r.status, 'review');
});

test('trip meter readings are kept in their own field and never count as mileage', async () => {
  const res: ProcessingResult = {
    schemaVersion: 1, processor: 't', subject: 'odometer', imageName: 't.jpg', imageSize: { width: 1, height: 1 },
    status: 'partial', warnings: ['Only a trip meter reading was found; the odometer is not visible in this photo.'], processedAt: '2026-10-30T00:00:00.000Z', durationMs: 1,
    values: [{ id: 'trip1', text: '123.4', value: 123.4, confidence: 0.99, box: null, field: 'trip', fieldConfidence: 0.9, decimalInferred: false, ambiguousDigits: [] }],
    fields: { trip: 'trip1' }, odometerUnit: 'mi',
  };
  const r = applyResult(newRecord('t', 't.jpg', 1), res);
  assert.equal(r.kind, 'odometer');
  assert.equal(r.trip.detected, 123.4);
  assert.equal(r.odometer.detected, null);
  assert.equal(canConfirm(r), true);
  assert.equal(effectiveValue(r.odometer), null); // a trip meter is never used as mileage
  const csv = recordsToCsv([r]).split('\r\n');
  assert.match(csv[1], /^t\.jpg,odometer,,,,,,missing,,mi,123\.4,/);
});
