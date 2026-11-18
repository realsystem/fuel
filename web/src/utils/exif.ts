/**
 * Minimal EXIF reader for the moment a photo was taken.
 *
 * It reads only the capture timestamp (and its UTC offset when the camera
 * wrote one). Location (the GPS section) is deliberately never read, and
 * nothing else about the camera is kept. It never throws: anything unexpected
 * returns null, and the caller falls back to the file's date.
 *
 * Why the offset matters: the timestamp in EXIF is local time. Pixel file
 * names such as PXL_20251206_033907 are UTC, so using the file name would put
 * an evening fill-up on the next day.
 */

export interface CaptureTime {
  /** Local date and time as photographed, "YYYY-MM-DDTHH:MM:SS". */
  local: string;
  /** UTC offset such as "-08:00", when the camera recorded it. */
  offset: string | null;
}

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_OFFSET_ORIGINAL = 0x9011;
const TAG_OFFSET_DIGITIZED = 0x9012;
const TAG_DATETIME = 0x0132;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;

interface Entry { type: number; count: number; valueAt: number }

function readEntries(v: DataView, ifd: number, little: boolean): Map<number, Entry> {
  const out = new Map<number, Entry>();
  if (ifd < 8 || ifd + 2 > v.byteLength) return out;
  const n = Math.min(v.getUint16(ifd, little), 512);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > v.byteLength) break;
    const type = v.getUint16(e + 2, little);
    const count = v.getUint32(e + 4, little);
    const size = type === TYPE_ASCII ? count : 4;
    // Values of 4 bytes or fewer live in the entry itself; larger ones at an offset.
    const valueAt = size <= 4 ? e + 8 : v.getUint32(e + 8, little);
    out.set(v.getUint16(e, little), { type, count, valueAt });
  }
  return out;
}

function ascii(v: DataView, e: Entry | undefined): string | null {
  if (!e || e.type !== TYPE_ASCII || e.count < 2 || e.count > 64) return null;
  const end = Math.min(e.valueAt + e.count, v.byteLength);
  if (e.valueAt < 0 || e.valueAt >= end) return null;
  let s = '';
  for (let i = e.valueAt; i < end; i++) {
    const c = v.getUint8(i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function parseTiff(v: DataView, base: number): CaptureTime | null {
  const view = new DataView(v.buffer, v.byteOffset + base, v.byteLength - base);
  const order = view.getUint16(0);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  if (view.getUint16(2, little) !== 42) return null;
  const ifd0 = readEntries(view, view.getUint32(4, little), little);
  const ptr = ifd0.get(TAG_EXIF_IFD);
  const exif = ptr && ptr.type === TYPE_LONG ? readEntries(view, view.getUint32(ptr.valueAt, little), little) : new Map<number, Entry>();

  const stamp = ascii(view, exif.get(TAG_DATETIME_ORIGINAL))
    ?? ascii(view, exif.get(TAG_DATETIME_DIGITIZED))
    ?? ascii(view, ifd0.get(TAG_DATETIME));
  const m = stamp ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(stamp) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (+y < 1990 || +mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 60) return null;

  const off = ascii(view, exif.get(TAG_OFFSET_ORIGINAL)) ?? ascii(view, exif.get(TAG_OFFSET_DIGITIZED));
  return { local: `${y}-${mo}-${d}T${h}:${mi}:${s}`, offset: off && /^[+-]\d{2}:\d{2}$/.test(off) ? off : null };
}

/** Read the capture time from the start of a JPEG file (the EXIF block is within the first ~64 KB). */
export function readCaptureTime(buf: ArrayBuffer): CaptureTime | null {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null;
    let p = 2;
    while (p + 4 <= v.byteLength) {
      if (v.getUint8(p) !== 0xff) return null;
      const marker = v.getUint8(p + 1);
      if (marker === 0xda || marker === 0xd9) return null; // image data: no EXIF found
      const len = v.getUint16(p + 2);
      if (marker === 0xe1 && len >= 8 && p + 4 + 6 <= v.byteLength
        && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) { // "Exif\0\0"
        return parseTiff(v, p + 10);
      }
      p += 2 + len;
    }
  } catch { /* malformed EXIF: treat as absent */ }
  return null;
}

/** "2025-12-05T19:39:07-08:00" from a CaptureTime. */
export function formatCaptureTime(t: CaptureTime): string {
  return t.local + (t.offset ?? '');
}
