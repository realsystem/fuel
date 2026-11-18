/**
 * Odometer path of the pipeline: pixels in, ProcessingResult out.
 * Used when a photo is not a fuel pump display.
 */
import { rgbaToValue } from './image.ts';
import { readOdometer } from './odometer/OdometerReader.ts';
import type { DetectedValue, ProcessingResult } from '../models/ProcessingResult.ts';

export const ODOMETER_PROCESSOR_ID = 'odometer-glyph@0.1.0';

export const NOT_RECOGNISED_MESSAGE =
  'This photo was not recognised as a fuel pump display or an odometer. If it is one of these, retake it closer and without glare, or enter the values by hand.';

export function processOdometerRgba(
  rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, imageName: string,
): ProcessingResult {
  const started = Date.now();
  const reading = readOdometer(rgbaToValue(rgba, width, height));
  const base = {
    schemaVersion: 1 as const,
    processor: ODOMETER_PROCESSOR_ID,
    imageName,
    imageSize: { width, height },
    processedAt: new Date().toISOString(),
  };
  const best = reading.best;
  const trip = reading.trip;
  if (reading.status === 'no_odometer' || (!best && !trip)) {
    return {
      ...base, subject: 'unrecognized', status: 'no_numbers', values: [], fields: {}, warnings: [NOT_RECOGNISED_MESSAGE],
      error: { code: 'no_numbers', message: NOT_RECOGNISED_MESSAGE },
      durationMs: Date.now() - started,
    };
  }
  const values: DetectedValue[] = [];
  const fields: ProcessingResult['fields'] = {};
  if (best) {
    values.push({
      id: 'odo1',
      text: best.digits,
      value: best.value,
      confidence: Math.round(best.minDigitP * 1000) / 1000,
      box: best.box,
      field: 'odometer',
      // Label or unit next to the number is what makes it an odometer rather than another number.
      fieldConfidence: best.hasLabel || best.unit ? 0.95 : 0.5,
      decimalInferred: false,
      ambiguousDigits: best.ambiguousDigits,
    });
    fields.odometer = 'odo1';
  }
  if (trip) {
    values.push({
      id: 'trip1',
      text: trip.digits,
      value: trip.value,
      confidence: Math.round(trip.minDigitP * 1000) / 1000,
      box: trip.box,
      field: 'trip',
      fieldConfidence: 0.9,
      decimalInferred: false,
      ambiguousDigits: trip.ambiguousDigits,
    });
    fields.trip = 'trip1';
  }
  return {
    ...base,
    subject: 'odometer',
    status: reading.status === 'ok' ? 'ok' : 'partial',
    values,
    fields,
    odometerUnit: best?.unit ?? trip?.unit ?? null,
    warnings: reading.warnings,
    durationMs: Date.now() - started,
  };
}
