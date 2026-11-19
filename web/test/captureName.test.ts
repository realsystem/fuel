import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeFromFileName } from '../src/services/CaptureTimeService.ts';

test('Pixel names are UTC, other camera names are local', () => {
  assert.equal(timeFromFileName('PXL_20261117_184636123.jpg', -480), '2026-11-17T18:46:36Z');
  assert.equal(timeFromFileName('IMG_20261117_104636.jpg', -480), '2026-11-17T10:46:36-08:00');
  assert.equal(timeFromFileName('20261117_104636.jpg', 60), '2026-11-17T10:46:36+01:00');
  assert.equal(timeFromFileName('2026-11-17 10.46.36.jpg', -480), '2026-11-17T10:46:36-08:00');
});

test('names without a real timestamp give nothing', () => {
  for (const n of ['IMG_1234.jpg', 'photo.jpg', 'IMG_20261317_104636.jpg', 'IMG_20260231_104636.jpg', '12345678901234.jpg'])
    assert.equal(timeFromFileName(n, -480), null, n);
});
