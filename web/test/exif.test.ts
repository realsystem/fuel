import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readCaptureTime, formatCaptureTime } from '../src/utils/exif.ts';
import { captureTimeOf } from '../src/services/CaptureTimeService.ts';

const IMAGES = join(new URL('.', import.meta.url).pathname, '../../images');
const buf = (f: string) => { const b = readFileSync(join(IMAGES, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

/** Build a tiny JPEG with an EXIF block holding the given strings. */
function jpegWithExif(opts: { little: boolean; stamp: string; offset?: string }): ArrayBuffer {
  const { little } = opts;
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const stamp = ascii(opts.stamp), off = opts.offset ? ascii(opts.offset) : [];
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >> 24] : [n >> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const exifEntries = off.length ? 2 : 1;
  const ifd0At = 8, exifAt = ifd0At + 2 + 12 + 4;
  const dataAt = exifAt + 2 + exifEntries * 12 + 4;
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At),
    ...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt), ...u32(0),
    ...u16(exifEntries), ...u16(0x9003), ...u16(2), ...u32(stamp.length), ...u32(dataAt),
    ...(off.length ? [...u16(0x9011), ...u16(2), ...u32(off.length), ...u32(dataAt + stamp.length)] : []),
    ...u32(0), ...stamp, ...off,
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const bytes = [0xff, 0xd8, 0xff, 0xe1, ...[(app1.length + 2) >> 8, (app1.length + 2) & 255], ...app1, 0xff, 0xd9];
  return new Uint8Array(bytes).buffer;
}

test('reads local capture time and UTC offset (little and big endian)', () => {
  for (const little of [true, false]) {
    const t = readCaptureTime(jpegWithExif({ little, stamp: '2025:12:05 19:39:07', offset: '-08:00' }));
    assert.deepEqual(t, { local: '2025-12-05T19:39:07', offset: '-08:00' });
    assert.equal(formatCaptureTime(t!), '2025-12-05T19:39:07-08:00');
  }
});

test('offset is optional', () => {
  assert.deepEqual(readCaptureTime(jpegWithExif({ little: true, stamp: '2024:01:02 03:04:05' })), { local: '2024-01-02T03:04:05', offset: null });
});

test('invalid or missing EXIF gives null and never throws', () => {
  assert.equal(readCaptureTime(new ArrayBuffer(0)), null);
  assert.equal(readCaptureTime(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).buffer), null);
  assert.equal(readCaptureTime(jpegWithExif({ little: true, stamp: '2025:13:45 99:99:99' })), null);
  const good = new Uint8Array(jpegWithExif({ little: true, stamp: '2025:12:05 19:39:07', offset: '-08:00' }));
  for (let cut = 0; cut < good.length; cut++) readCaptureTime(good.slice(0, cut).buffer); // truncations must not throw
});

test('real phone photo: local time, not the UTC time in the file name', () => {
  // PXL_20251206_033907396 is UTC; the photo was taken at 19:39 on 5 December in UTC-8.
  assert.equal(formatCaptureTime(readCaptureTime(buf('PXL_20251206_033907396.jpg'))!), '2025-12-05T19:39:07-08:00');
});

test('photos without EXIF fall back to the file date, labelled as such', async () => {
  const blob = Object.assign(new Blob([new Uint8Array(buf('fuel1.jpeg'))]), { lastModified: Date.UTC(2026, 0, 2, 12) });
  const c = await captureTimeOf(blob);
  assert.equal(c?.source, 'file');
  assert.match(c!.at, /^2026-01-0[12]T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(await captureTimeOf(Object.assign(new Blob([new Uint8Array(buf('fuel1.jpeg'))]), { lastModified: 0 })), null);
});

test('every phone photo that has a timestamp is read', () => {
  const phone = readdirSync(IMAGES).filter((f) => f.startsWith('PXL_'));
  const read = phone.filter((f) => readCaptureTime(buf(f)) !== null);
  assert.ok(read.length >= 40, `expected most phone photos to have EXIF, got ${read.length}/${phone.length}`);
});
