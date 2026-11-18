/**
 * Tiny glyph classifier (one hidden layer) for dashboard text.
 * Weights are trained offline on synthetic font renders (tools/train_glyphs.py);
 * no photos are involved. Input: a binary ink mask of one connected component.
 */
import { GLYPH_CLASSES, GLYPH_W, GLYPH_H, GLYPH_IN, GLYPH_HIDDEN, W1, B1, W2, B2 } from './glyphModel.ts';
import type { Mask, Rect } from '../image.ts';

export type GlyphClass = (typeof GLYPH_CLASSES)[number];

export interface GlyphGuess {
  cls: GlyphClass;
  /** Probability of the winning class. */
  p: number;
  /** Probability per class, same order as GLYPH_CLASSES. */
  probs: number[];
  /** Best digit if the winner is not a digit (used to report alternatives). */
  bestDigit: string;
  /** True when different crops of the same glyph gave different answers. */
  unstable?: boolean;
}

/** Area-average a crop of the mask to GLYPH_W x GLYPH_H and add aspect and fill features. */
function features(mask: Mask, labels: Int32Array, label: number, r: Rect): Float32Array {
  const f = new Float32Array(GLYPH_IN);
  const sx = r.width / GLYPH_W, sy = r.height / GLYPH_H;
  let ink = 0;
  for (let gy = 0; gy < GLYPH_H; gy++) {
    const y0 = r.y + gy * sy, y1 = r.y + (gy + 1) * sy;
    for (let gx = 0; gx < GLYPH_W; gx++) {
      const x0 = r.x + gx * sx, x1 = r.x + (gx + 1) * sx;
      let s = 0, n = 0;
      for (let y = Math.floor(y0); y < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); y++) {
        for (let x = Math.floor(x0); x < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); x++) {
          n++;
          if (x < mask.width && y < mask.height && labels[y * mask.width + x] === label) s++;
        }
      }
      f[gy * GLYPH_W + gx] = n ? s / n : 0;
    }
  }
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) if (labels[y * mask.width + x] === label) ink++;
  }
  f[GLYPH_W * GLYPH_H] = Math.min(r.width / r.height, 2) / 2;
  f[GLYPH_W * GLYPH_H + 1] = ink / (r.width * r.height);
  return f;
}

export function classifyComponent(mask: Mask, labels: Int32Array, label: number, r: Rect): GlyphGuess {
  return classifyRect(mask, labels, label, r);
}

function classifyRect(mask: Mask, labels: Int32Array, label: number, r: Rect): GlyphGuess {
  const x = features(mask, labels, label, r);
  const h = new Float32Array(GLYPH_HIDDEN);
  for (let j = 0; j < GLYPH_HIDDEN; j++) {
    let s = B1[j];
    for (let i = 0; i < GLYPH_IN; i++) s += x[i] * W1[i * GLYPH_HIDDEN + j];
    h[j] = s > 0 ? s : 0;
  }
  const nC = GLYPH_CLASSES.length;
  const z = new Array<number>(nC);
  let max = -Infinity;
  for (let c = 0; c < nC; c++) {
    let s = B2[c];
    for (let j = 0; j < GLYPH_HIDDEN; j++) s += h[j] * W2[j * nC + c];
    z[c] = s;
    if (s > max) max = s;
  }
  let sum = 0;
  for (let c = 0; c < nC; c++) { z[c] = Math.exp(z[c] - max); sum += z[c]; }
  const probs = z.map((v) => v / sum);
  let best = 0, bestDigit = 0;
  for (let c = 0; c < nC; c++) {
    if (probs[c] > probs[best]) best = c;
    if (c < 10 && probs[c] > probs[bestDigit]) bestDigit = c;
  }
  return { cls: GLYPH_CLASSES[best], p: probs[best], probs, bestDigit: String(bestDigit) };
}
