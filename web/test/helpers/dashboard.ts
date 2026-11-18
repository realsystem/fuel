/**
 * Synthetic dashboard screens rendered from SVG text (no photo files). Used to
 * test the odometer reader on readings it must accept and on numbers that look
 * like an odometer but are not one (range, trip, clock, speed).
 */
import sharp from 'sharp';

export interface DashLine { text: string; x: number; y: number; size: number; color?: string; family?: string; weight?: string }
export interface Rgba { data: Uint8Array; width: number; height: number }

export async function renderDashboard(lines: DashLine[], opts: { width?: number; height?: number; bg?: string; blur?: number; rotate?: number; panel?: string } = {}): Promise<Rgba> {
  const w = opts.width ?? 1600, h = opts.height ?? 900;
  const bg = opts.bg ?? '#0b0f14';
  const body = lines.map((l) =>
    `<text x="${l.x}" y="${l.y}" font-size="${l.size}" font-family="${l.family ?? 'DejaVu Sans, Liberation Sans, sans-serif'}" font-weight="${l.weight ?? 'normal'}" fill="${l.color ?? '#f2f6fa'}">${l.text}</text>`).join('');
  // A few gauge-like rings and bars so the scene is not just text.
  const deco = `<circle cx="300" cy="450" r="260" fill="none" stroke="#9aa3ad" stroke-width="10"/><circle cx="1300" cy="450" r="260" fill="none" stroke="#9aa3ad" stroke-width="10"/><rect x="520" y="120" width="560" height="640" rx="18" fill="${opts.panel ?? '#141b24'}" stroke="#3a4552" stroke-width="6"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${deco}${body}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (opts.rotate) img = img.rotate(opts.rotate, { background: bg });
  if (opts.blur) img = img.blur(opts.blur);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}
