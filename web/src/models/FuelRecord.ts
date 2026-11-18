/**
 * A fuel record is what the user reviews and edits. It keeps the detection
 * result untouched and stores user corrections next to it, so editing a
 * field never discards what the detector found.
 */
import type { ProcessingResult } from './ProcessingResult.ts';

export type ValueSource = 'detected' | 'user' | 'derived' | 'missing';

export interface FieldValue {
  /** Value from the detector (null when not detected). Never overwritten by edits. */
  detected: number | null;
  detectedText: string | null;
  /** 0..1 confidence of the detected value. */
  confidence: number;
  /** User-entered correction; null when the user has not edited this field. */
  corrected: number | null;
  /** Value computed from other fields (e.g. unit price = amount / volume). */
  derived: number | null;
}

export type RecordStatus =
  | 'queued'      // waiting to be processed
  | 'processing'
  | 'review'      // detection incomplete or uncertain: user should check
  | 'detected'    // detection looks consistent but the user has not confirmed it
  | 'confirmed'   // user confirmed the values
  | 'failed';

/** What a photo was recognised as. null until it has been processed. */
export type RecordKind = 'fuel_pump' | 'odometer' | 'unrecognized';

export interface FuelRecord {
  id: string;
  fileName: string;
  fileSize: number;
  /** When the photo was taken, "YYYY-MM-DDTHH:MM:SS±HH:MM" (local time of the camera). */
  capturedAt: string | null;
  /** 'exif' = from the photo's metadata; 'file' = the file's modified date (less reliable). */
  capturedSource: 'exif' | 'file' | null;
  /** Set from the processing result: pump photos and odometer photos are separated automatically. */
  kind: RecordKind | null;
  status: RecordStatus;
  amount: FieldValue;
  volume: FieldValue;
  unitPrice: FieldValue;
  /** Odometer reading (only used when kind is 'odometer'). */
  odometer: FieldValue;
  /** Trip meter reading (distance since the last reset); only used when kind is 'odometer'. Never used as a mileage. */
  trip: FieldValue;
  odometerUnit: 'mi' | 'km' | null;
  /** True for a row loaded from a CSV exported earlier: it has no photo here. */
  imported: boolean;
  /** Pump records: the tank was filled to the same level as at the previous fill-up. Partial fills are rolled into the next full one. */
  fullTank: boolean;
  result: ProcessingResult | null;
  /** Human-readable reason when status is 'review' or 'failed'. */
  note: string | null;
  processedAt: string | null;
}

export type FuelField = 'amount' | 'volume' | 'unitPrice' | 'odometer' | 'trip';
export const FUEL_FIELDS: readonly FuelField[] = ['volume', 'amount', 'unitPrice'];
export const ODOMETER_FIELDS: readonly FuelField[] = ['odometer'];

export function emptyField(): FieldValue {
  return { detected: null, detectedText: null, confidence: 0, corrected: null, derived: null };
}

/** The value to use: user correction, else detection, else derived estimate. */
export function effectiveValue(f: FieldValue): number | null {
  return f.corrected ?? f.detected ?? f.derived;
}

export function valueSource(f: FieldValue): ValueSource {
  if (f.corrected !== null) return 'user';
  if (f.detected !== null) return 'detected';
  if (f.derived !== null) return 'derived';
  return 'missing';
}

export function isCorrected(r: FuelRecord): boolean {
  return r.amount.corrected !== null || r.volume.corrected !== null || r.unitPrice.corrected !== null || r.odometer.corrected !== null || r.trip.corrected !== null;
}
