/**
 * Local regression over real dashboard photos in ../images/odometer with
 * expected.json beside them. The photos and the expected mileages are not in
 * the repository (private and may carry location data); without them this
 * test is skipped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRgba } from '../scripts/loadImage.ts';
import { rgbaToValue } from '../src/processor/image.ts';
import { readOdometer } from '../src/processor/odometer/OdometerReader.ts';

const dir = join(import.meta.dirname, '..', '..', 'images', 'odometer');
const have = existsSync(join(dir, 'expected.json'));

test('odometer photos: accuracy and honest review flags', { skip: !have && 'odometer photos not present (../images/odometer)' }, async () => {
  const exp: Record<string, { odometer: number | null }> = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  let correct = 0, scored = 0;
  const silentlyWrong: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /\.(jpe?g|png)$/i.test(x))) {
    if (!(f in exp)) continue;
    const img = await loadRgba(join(dir, f));
    const r = readOdometer(rgbaToValue(img.data, img.width, img.height));
    const got = r.best?.value ?? null;
    scored++;
    if (got === exp[f].odometer) correct++;
    else if (r.status === 'ok' && got !== null) silentlyWrong.push(f);
  }
  assert.deepEqual(silentlyWrong, [], 'a wrong reading must never be accepted without a review flag');
  assert.ok(correct >= Math.min(9, scored), `expected at least 9 correct, got ${correct}/${scored}`);
});
