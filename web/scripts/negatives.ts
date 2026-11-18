/**
 * False-reading check: run the detector on images that are NOT fuel pump
 * displays (landscapes, documents, patterns) and report how often it still
 * invents numbers. A good result is "no_numbers" or a clearly rejected image.
 * Usage: tsx scripts/negatives.ts <dir-of-non-pump-images> [--verbose]
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRgba } from './loadImage.ts';
import { processRgba } from '../src/processor/ImageProcessor.ts';

const dir = process.argv[2];
if (!dir) { console.log('usage: tsx scripts/negatives.ts <dir> [--verbose]'); process.exit(1); }
const verbose = process.argv.includes('--verbose');

let n = 0, withNumbers = 0, accepted = 0;
const offenders: string[] = [];
for (const f of readdirSync(dir).sort()) {
  if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
  const img = await loadRgba(join(dir, f));
  const r = processRgba(img.data, img.width, img.height, f);
  n++;
  const texts = r.values.map((v) => v.text);
  const numbers = r.status !== 'no_numbers' && r.status !== 'error' && r.values.length > 0;
  if (numbers) { withNumbers++; offenders.push(`${f.padEnd(40)} ${r.status.padEnd(8)} ${texts.join(' | ')}`); }
  if (r.status === 'ok') accepted++;
  if (verbose && !numbers) console.log(`${f.padEnd(40)} ${r.status}`);
}
console.log(`\n${n} non-pump images: ${withNumbers} produced numbers (${accepted} accepted as "ok")`);
if (offenders.length) console.log('numbers invented for:\n  ' + offenders.join('\n  '));
