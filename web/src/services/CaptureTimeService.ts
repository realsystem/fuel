/**
 * When was this photo taken? EXIF first (exact, includes the camera's UTC
 * offset); otherwise the file's modified date, labelled as less reliable
 * because it may be the day the file was downloaded or copied.
 */
import { formatCaptureTime, readCaptureTime } from '../utils/exif.ts';

export type CaptureSource = 'exif' | 'file';
export interface Capture { at: string; source: CaptureSource }

const HEAD_BYTES = 256 * 1024;

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

export async function captureTimeOf(file: Blob & { lastModified?: number }): Promise<Capture | null> {
  try {
    const exif = readCaptureTime(await file.slice(0, HEAD_BYTES).arrayBuffer());
    if (exif) return { at: formatCaptureTime(exif), source: 'exif' };
  } catch { /* unreadable: fall through to the file date */ }
  const t = file.lastModified;
  return t && Number.isFinite(t) && t > 0 ? { at: localIso(new Date(t)), source: 'file' } : null;
}
