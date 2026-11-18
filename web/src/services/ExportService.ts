/**
 * CSV export of the current records. Exports values only: no images, no
 * image metadata, no bounding boxes.
 */
import { effectiveValue, isCorrected, valueSource, type FuelRecord } from '../models/FuelRecord.ts';
import { FIELD_DECIMALS, formatFixed } from '../utils/numberFormatting.ts';
import { dedupeRecords } from './ImportService.ts';

export const CSV_COLUMNS = [
  'file_name',
  'kind',
  'captured_at',
  'captured_source',
  'fuel_volume',
  'amount',
  'unit_price',
  'unit_price_source',
  'odometer',
  'odometer_unit',
  'trip_meter',
  'full_tank',
  'detection_status',
  'record_status',
  'user_corrected',
  'processed_at',
] as const;

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function recordsToCsv(records: FuelRecord[]): string {
  const rows = [CSV_COLUMNS.join(',')];
  // Photos that were not recognised hold no data; duplicates (a photo re-uploaded after its row was imported) are written once.
  for (const r of dedupeRecords(records).filter((x) => x.kind !== 'unrecognized')) {
    rows.push([
      r.fileName,
      r.kind ?? '',
      r.capturedAt ?? '',
      r.capturedSource ?? '',
      formatFixed(effectiveValue(r.volume), FIELD_DECIMALS.volume),
      formatFixed(effectiveValue(r.amount), FIELD_DECIMALS.amount),
      formatFixed(effectiveValue(r.unitPrice), FIELD_DECIMALS.unitPrice),
      valueSource(r.unitPrice),
      formatFixed(effectiveValue(r.odometer), FIELD_DECIMALS.odometer),
      r.kind === 'odometer' ? (r.odometerUnit ?? '') : '',
      formatFixed(effectiveValue(r.trip), FIELD_DECIMALS.trip),
      r.kind === 'fuel_pump' ? (r.fullTank ? 'yes' : 'no') : '',
      r.imported ? 'imported' : (r.result?.status ?? 'not_processed'),
      r.status,
      isCorrected(r) ? 'yes' : 'no',
      r.processedAt ?? '',
    ].map(csvCell).join(','));
  }
  // CRLF per RFC 4180; opens cleanly in spreadsheet apps.
  return rows.join('\r\n') + '\r\n';
}

export function csvFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `fuel-records-${d}.csv`;
}
