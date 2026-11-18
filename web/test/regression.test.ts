/**
 * Regression test over the real photos in ../images (expected values in
 * fixtures/expected.json). Fails if accuracy drops below the recorded level,
 * or if any wrong reading is accepted without a review flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photosAvailable, runAccuracy, summarize } from '../scripts/accuracy.ts';

// Levels at the time of writing; lower them only with a reason.
const MIN_CORRECT = { tuning: 8, phone: 29 };
// Photos in each set when the full collection is present (a partial local copy is scaled down).
const FULL = { tuning: 8, phone: 42 };

// The photos are not stored in the repository (they can carry location data).
// Put them in ../images to run this check locally; without them it is skipped.
test('regression photos: accuracy and honest review flags', { skip: !photosAvailable() && 'photos not present (../images)' }, async () => {
  const rows = await runAccuracy();
  assert.ok(rows.length > 0);

  const silentlyWrong = rows.filter((r) => !r.needsReview && (!r.correct || r.hasWrongValue));
  assert.deepEqual(silentlyWrong.map((r) => r.image), [], 'wrong values must be flagged for review');

  for (const set of ['tuning', 'phone'] as const) {
    const s = summarize(rows.filter((r) => r.set === set));
    if (!s.scored) continue;
    const need = Math.floor((MIN_CORRECT[set] * s.scored) / FULL[set]);
    assert.ok(s.correct >= need, `${set}: expected at least ${need} fully correct, got ${s.correct}/${s.scored}`);
  }
});
