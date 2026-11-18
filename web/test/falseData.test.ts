/**
 * Protection from false data: photos that are not fuel pump displays must not
 * produce numbers, and a lone number must not be enough to pre-fill anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processRgba, looksLikePumpDisplay } from '../src/processor/ImageProcessor.ts';
import { isPlausibleLine, type DetectedDigit, type DetectedLine } from '../src/processor/NumberDetector.ts';
import { DEFAULT_CONFIG } from '../src/processor/config.ts';
import type { RawLine } from '../src/processor/ResultNormalizer.ts';
import { applyResult, newRecord } from '../src/services/RecordService.ts';
import { renderDisplay } from './helpers/sevenSegment.ts';
import { blankScene, checkerScene, fenceScene, forestScene, noiseScene, type Rgba } from './helpers/scenes.ts';

const read = (img: Rgba, name = 'scene.png') => processRgba(img.data, img.width, img.height, name);

test('scenes that are not pump displays produce no numbers', () => {
  const scenes: Array<[string, Rgba]> = [
    ...[1, 2, 3, 4, 5, 6].map((s): [string, Rgba] => [`noise ${s}`, noiseScene(s)]),
    ...[11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((s): [string, Rgba] => [`forest with trucks ${s}`, forestScene(s)]),
    ...[21, 22, 23, 24].map((s): [string, Rgba] => [`fence ${s}`, fenceScene(s)]),
    ['checkerboard 20', checkerScene(20)], ['checkerboard 55', checkerScene(55)],
    ['blank dark', blankScene(20)], ['blank bright', blankScene(240)],
  ];
  const invented = scenes
    .map(([name, img]) => ({ name, r: read(img, name) }))
    .filter(({ r }) => r.values.length > 0 || r.status === 'ok' || r.status === 'partial')
    .map(({ name, r }) => `${name}: ${r.status} ${r.values.map((v) => v.text).join(' | ')}`);
  assert.deepEqual(invented, [], 'no numbers may be invented for non-pump images');
});

test('a non-pump photo becomes a review row with a clear message and no values', () => {
  const r = read(forestScene(3), 'trucks.jpg');
  assert.equal(r.status, 'no_numbers');
  const rec = applyResult(newRecord('x', 'trucks.jpg', 1), r);
  assert.equal(rec.status, 'review');
  assert.equal(rec.amount.detected, null);
  assert.equal(rec.volume.detected, null);
  assert.match(rec.note ?? '', /No fuel pump display was recognised/);
});

test('real-looking pump displays are still read', () => {
  const r = read(renderDisplay({ lines: ['45.67', '12.345'] }), 'pump.png');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.values.map((v) => v.text), ['45.67', '12.345']);
});

test('a single number is not enough to call it a pump display', () => {
  const r = read(renderDisplay({ lines: ['45.67'] }), 'one-line.png');
  assert.equal(r.status, 'no_numbers');
  assert.equal(r.values.length, 0);
});

// --- the individual rules ---

const digit = (char: string, clutter = 0): DetectedDigit => ({ char, score: 0.95, clutter, box: { x: 0, y: 0, width: 10, height: 20 } });
const line = (chars: string, clutters: number[] = []): DetectedLine => ({
  text: chars, digits: [...chars].map((c, i) => digit(c, clutters[i] ?? 0)), decimalIndex: 2,
  box: { x: 0, y: 0, width: 50, height: 20 }, digitHeight: 20, confidence: 0.95, incomplete: false,
});

test('line rules: too few digits, all-bars and cluttered digits are rejected', () => {
  const cfg = DEFAULT_CONFIG;
  assert.equal(isPlausibleLine(line('4567'), cfg), true);
  assert.equal(isPlausibleLine(line('45'), cfg), false, 'fewer than 3 digits');
  assert.equal(isPlausibleLine(line('1111'), cfg), false, 'a row of bars is a fence, not a number');
  assert.equal(isPlausibleLine(line('4567', [0.9, 0.9, 0.9, 0]), cfg), false, 'mostly cluttered digits');
  assert.equal(isPlausibleLine(line('4567', [0.5, 0, 0, 0]), cfg), true, 'one cluttered digit in four is tolerated');
});

test('pump-display rule: two numbers and a decimal point', () => {
  const raw = (decimalIndex: number): RawLine => ({ text: '1.23', decimalIndex, digitCount: 3, confidence: 0.9, box: null, ambiguousDigits: [] });
  assert.equal(looksLikePumpDisplay([raw(1), raw(2)]), true);
  assert.equal(looksLikePumpDisplay([raw(1)]), false, 'one line');
  assert.equal(looksLikePumpDisplay([raw(-1), raw(-1)]), false, 'no decimal point anywhere');
  assert.equal(looksLikePumpDisplay([]), false);
});
