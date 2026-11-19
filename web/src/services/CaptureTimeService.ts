/**
 * When was this photo taken? EXIF first (exact, includes the camera's UTC
 * offset); then a timestamp in the file name (for photos whose metadata was
 * stripped by a messaging or sharing app); otherwise the file's modified date,
 * labelled as less reliable because it may be the day the file was copied.
 */
import { formatCaptureTime, readCaptureTime } from '../utils/exif.ts';

export type CaptureSource = 'exif' | 'name' | 'file';
export interface Capture { at: string; source: CaptureSource }

const HEAD_BYTES = 256 * 1024;

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

/**
 * A timestamp in a camera-style file name: PXL_20261117_184636123.jpg (Pixel; the time is UTC),
 * IMG_20261117_104636.jpg, 20261117_104636.jpg, 2026-11-17 10.46.36.jpg (local time).
 * Returns an ISO time with its offset, or null. Names with no time (IMG_1234.jpg) give null.
 */
export function timeFromFileName(name: string, localOffsetMinutes: number = -new Date().getTimezoneOffset()): string | null {
  const base = name.replace(/^.*[\\/]/, '');
  const m = /(?:^|[^0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])[-_. T]?([01]\d|2[0-3])[-_.:]?([0-5]\d)[-_.:]?([0-5]\d)/.exec(base);
  if (!m) return null;
  const date = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(date).getUTCDate() !== +m[3]) return null; // e.g. 31 February
  const pixel = /^PXL_/i.test(base);
  const a = pixel ? 0 : Math.abs(localOffsetMinutes);
  const off = pixel ? 'Z' : `${localOffsetMinutes < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`;
}

export async function captureTimeOf(file: Blob & { lastModified?: number; name?: string }): Promise<Capture | null> {
  try {
    const exif = readCaptureTime(await file.slice(0, HEAD_BYTES).arrayBuffer());
    if (exif) return { at: formatCaptureTime(exif), source: 'exif' };
  } catch { /* unreadable: fall through to the file date */ }
  const named = file.name ? timeFromFileName(file.name) : null;
  if (named) return { at: named, source: 'name' };
  const t = file.lastModified;
  return t && Number.isFinite(t) && t > 0 ? { at: localIso(new Date(t)), source: 'file' } : null;
}
