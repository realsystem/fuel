/** Run the odometer reader over a folder: npm run odometer -- <dir> [expected.json] */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRgba } from './loadImage.ts';
import { rgbaToValue } from '../src/processor/image.ts';
import { readOdometer } from '../src/processor/odometer/OdometerReader.ts';

const dir = process.argv[2] ?? '../images/odometer';
const expPath = join(dir, 'expected.json');
const exp: Record<string, { odometer: number | null }> = existsSync(expPath) ? JSON.parse(readFileSync(expPath, 'utf8')) : {};
let ok = 0, n = 0, wrongConfident = 0;
for (const f of readdirSync(dir).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()) {
  const img = await loadRgba(join(dir, f));
  const t0 = Date.now();
  const r = readOdometer(rgbaToValue(img.data, img.width, img.height));
  const b = r.best;
  const want = exp[f]?.odometer;
  const got = b ? b.value : null;
  const match = want === undefined ? '' : got === want ? 'OK ' : 'ERR';
  if (want !== undefined) { n++; if (got === want) ok++; else if (r.status === 'ok' && got !== null) wrongConfident++; }
  console.log(`${match} ${f.padEnd(30)} ${r.status.padEnd(11)} got=${b ? b.digits + (b.unit ?? '') + (b.hasLabel ? ' ODO' : '') + ` p=${b.minDigitP.toFixed(2)}` : '-'} want=${want} ${Date.now() - t0}ms`);
  if (process.argv.includes('--verbose')) for (const c of r.candidates) console.log('     ', c.digits, c.unit, c.hasLabel, c.score.toFixed(2), c.polarity);
}
if (n) console.log(`\n${ok}/${n} correct; confident-but-wrong: ${wrongConfident}`);
