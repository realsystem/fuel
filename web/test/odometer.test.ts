import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOdometer } from '../src/processor/odometer/OdometerReader.ts';
import { processOdometerRgba } from '../src/processor/OdometerProcessor.ts';
import { rgbaToValue } from '../src/processor/image.ts';
import { renderDashboard } from './helpers/dashboard.ts';
import { forestScene, noiseScene } from './helpers/scenes.ts';

const read = async (lines: Parameters<typeof renderDashboard>[0], opts?: Parameters<typeof renderDashboard>[1]) => {
  const img = await renderDashboard(lines, opts);
  return readOdometer(rgbaToValue(img.data, img.width, img.height));
};

test('reads a labelled odometer with a unit', async () => {
  const r = await read([
    { text: 'ODO', x: 560, y: 600, size: 44 },
    { text: '53164 mi', x: 700, y: 600, size: 52 },
  ]);
  assert.equal(r.status, 'ok');
  assert.equal(r.best?.value, 53164);
  assert.equal(r.best?.hasLabel, true);
});

test('reads a short odometer only when it has the ODO label', async () => {
  const r = await read([{ text: 'ODO', x: 560, y: 600, size: 44 }, { text: '483 mi', x: 700, y: 600, size: 52 }]);
  assert.equal(r.best?.value, 483);
  assert.equal(r.status, 'ok');
});

test('a 6-digit reading with leading zeros keeps its value', async () => {
  const r = await read([{ text: '099999 miles', x: 600, y: 600, size: 52 }]);
  assert.equal(r.best?.value, 99999);
});

test('works on dark text on a light display', async () => {
  const r = await read([
    { text: 'ODO', x: 560, y: 600, size: 44, color: '#101418' },
    { text: '12700 km', x: 700, y: 600, size: 52, color: '#101418' },
  ], { bg: '#d8dde2', panel: '#e6eaee' });
  assert.equal(r.best?.value, 12700);
});

// Numbers that look like an odometer but are not one must not be reported as mileage.
for (const [name, lines] of [
  ['range', [{ text: 'Range', x: 560, y: 560, size: 40 }, { text: '343 miles', x: 700, y: 620, size: 52 }]],
  ['distance to empty', [{ text: 'Distance to Empty', x: 560, y: 560, size: 36 }, { text: '252 miles', x: 700, y: 620, size: 52 }]],
  ['trip with a decimal', [{ text: '123.4 mi', x: 700, y: 600, size: 52 }]],
  ['clock', [{ text: '6:20', x: 700, y: 600, size: 52 }]],
  ['speed', [{ text: '48', x: 700, y: 600, size: 90 }, { text: 'mph', x: 820, y: 600, size: 36 }]],
  ['fuel economy', [{ text: '35.6 mpg', x: 700, y: 600, size: 52 }]],
] as const) {
  test(`does not take "${name}" for the odometer`, async () => {
    const r = await read(lines as never);
    assert.equal(r.best, null, `read ${r.best?.digits} as mileage`);
  });
}

test('a bare 5-digit number without label or unit is offered only for review', async () => {
  const r = await read([{ text: '16864', x: 700, y: 600, size: 52 }]);
  if (r.best) { assert.equal(r.best.value, 16864); assert.notEqual(r.status, 'ok'); }
});

test('noise and foliage produce no odometer', () => {
  for (const img of [noiseScene(1), noiseScene(2), forestScene(3), forestScene(4)]) {
    const r = readOdometer(rgbaToValue(img.data, img.width, img.height));
    assert.equal(r.best, null);
  }
});

test('processOdometerRgba builds a schema-v1 result for an odometer, and "unrecognized" otherwise', async () => {
  const img = await renderDashboard([{ text: 'ODO', x: 560, y: 600, size: 44 }, { text: '24485 miles', x: 700, y: 600, size: 52 }]);
  const ok = processOdometerRgba(img.data, img.width, img.height, 'x.jpg');
  assert.equal(ok.schemaVersion, 1);
  assert.equal(ok.subject, 'odometer');
  assert.equal(ok.values[0].value, 24485);
  assert.equal(ok.fields.odometer, ok.values[0].id);
  const none = noiseScene(9);
  const r = processOdometerRgba(none.data, none.width, none.height, 'n.jpg');
  assert.equal(r.subject, 'unrecognized');
  assert.equal(r.status, 'no_numbers');
});
