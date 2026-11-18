/**
 * Odometer reader for dashboard photos.
 *
 * No generic OCR: it finds text-like components in both polarities (light on
 * dark TFT, dark on light), classifies each glyph with a tiny model trained on
 * synthetic fonts, groups glyphs into lines, and then applies the rules that
 * make an odometer an odometer:
 *   - an "ODO" label to the left, or a distance unit ("mi" / "km") to the right
 *   - 3-4 digits are accepted only with the label (the number next to "Range",
 *     "Distance to Empty" or a speed has the same shape but is not mileage)
 *   - a decimal point (trip, mpg) or a colon (clock) next to the digits rejects it
 * Anything that does not satisfy these is reported as a candidate that needs
 * review, never as a confident reading.
 */
import { adaptiveThresholdDark, connectedComponents, invert, resize, type GrayImage, type Mask, type Rect } from '../image.ts';
import { classifyComponent, type GlyphGuess } from './glyphClassifier.ts';

export interface OdometerCandidate {
  /** 'odometer' is the total distance; 'trip' is a trip meter (a smaller number, usually with a decimal). */
  kind: 'odometer' | 'trip';
  /** Digits as shown; a trip meter keeps its decimal point ("123.4"). */
  digits: string;
  value: number;
  unit: 'mi' | 'km' | null;
  hasLabel: boolean;
  /** Lowest per-digit probability. */
  minDigitP: number;
  /** Combined score used to pick between candidates. */
  score: number;
  box: { x: number; y: number; width: number; height: number };
  polarity: 'light-on-dark' | 'dark-on-light';
  ambiguousDigits: Array<{ index: number; alternative: string }>;
  notes: string[];
}

export interface OdometerReading {
  /** no_odometer: nothing found. partial: found but needs checking (also when only a trip meter was found). */
  status: 'ok' | 'partial' | 'no_odometer';
  best: OdometerCandidate | null;
  candidates: OdometerCandidate[];
  /** Best trip-meter reading, if the photo shows one. */
  trip: OdometerCandidate | null;
  warnings: string[];
}

export interface OdometerConfig {
  maxSide: number;
  blockSize: number;
  threshold: number;
  minGlyphHeight: number;
  maxGlyphHeightFraction: number;
  /** Digits taller than this fraction of the photo need an ODO label to be accepted. */
  maxUnlabelledHeightFraction: number;
  /** A trip meter is never accepted for glyphs smaller than this fraction of the photo (specks, texture). */
  minTripHeightFraction: number;
  minDigitP: number;
}

export const ODOMETER_CONFIG: OdometerConfig = {
  maxSide: 2600,
  blockSize: 41,
  threshold: 14,
  minGlyphHeight: 9,
  maxGlyphHeightFraction: 0.12,
  maxUnlabelledHeightFraction: 0.06,
  minTripHeightFraction: 0.01,
  minDigitP: 0.55,
};

/** Letters that touch (blur, thick fonts) form one wide blob: cut it at the thinnest column. */
function splitWide(mask: Mask, labels: Int32Array, c: { x: number; y: number; width: number; height: number; label: number }): Rect[] {
  if (c.width / c.height <= 1.15) return [c];
  const proj = new Array<number>(c.width).fill(0);
  for (let y = c.y; y < c.y + c.height; y++) for (let x = 0; x < c.width; x++) if (labels[y * mask.width + c.x + x] === c.label) proj[x]++;
  let cut = -1, best = Infinity;
  for (let x = Math.floor(c.width * 0.3); x <= Math.ceil(c.width * 0.7); x++) if (proj[x] < best) { best = proj[x]; cut = x; }
  if (cut < 0 || best > c.height * 0.5) return [c];
  const tight = (x0: number, x1: number): Rect | null => {
    let ax = Infinity, bx = -1, ay = Infinity, by = -1;
    for (let y = c.y; y < c.y + c.height; y++) for (let x = x0; x < x1; x++) if (labels[y * mask.width + c.x + x] === c.label) { if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
    return bx < 0 ? null : { x: c.x + ax, y: ay, width: bx - ax + 1, height: by - ay + 1 };
  };
  const l = tight(0, cut), r = tight(cut + 1, c.width);
  return [l, r].filter((p): p is Rect => !!p && p.width >= 2 && p.height >= 6);
}

const WORD_GUESS: GlyphGuess = { cls: 'other', p: 1, probs: new Array(14).fill(0).map((_, i) => (i === 13 ? 1 : 0)), bestDigit: '0' };

interface Glyph {
  x: number; y: number; w: number; h: number; cx: number; cy: number;
  g: GlyphGuess;
  /** A merged word blob, not a single glyph. */
  isWord?: boolean;
  /** Re-classify this component from a different crop (used to drop stuck-on bezel edges). */
  retry: (r: Rect) => GlyphGuess;
}
interface Dot { x: number; y: number; w: number; h: number; cx: number; cy: number }

export function readOdometer(gray: GrayImage, cfg: OdometerConfig = ODOMETER_CONFIG): OdometerReading {
  let img = gray;
  let scale = 1;
  const side = Math.max(gray.width, gray.height);
  if (side > cfg.maxSide) {
    scale = cfg.maxSide / side;
    img = resize(gray, Math.round(gray.width * scale), Math.round(gray.height * scale));
  }
  const candidates: OdometerCandidate[] = [];
  // Two scales: dust and speckle that break glyphs apart at full size average out at half size,
  // and large digits get a block size that suits them.
  for (const k of [1, 0.5]) {
    const level = k === 1 ? img : resize(img, Math.round(img.width * k), Math.round(img.height * k));
    for (const polarity of ['light-on-dark', 'dark-on-light'] as const) {
      const src = polarity === 'light-on-dark' ? invert(level) : level;
      const mask = adaptiveThresholdDark(src, cfg.blockSize, cfg.threshold);
      for (const c of candidatesFromMask(mask, polarity, cfg)) {
        const f = 1 / (scale * k);
        c.box = { x: Math.round(c.box.x * f), y: Math.round(c.box.y * f), width: Math.round(c.box.width * f), height: Math.round(c.box.height * f) };
        candidates.push(c);
      }
    }
  }
  return decide(dedupe(candidates), cfg);
}

function candidatesFromMask(mask: Mask, polarity: OdometerCandidate['polarity'], cfg: OdometerConfig): OdometerCandidate[] {
  const { labels, components } = connectedComponents(mask);
  const maxH = mask.height * cfg.maxGlyphHeightFraction;
  const glyphs: Glyph[] = [];
  const words: Glyph[] = [];
  const dots: Dot[] = [];
  for (const c of components) {
    if (c.height >= cfg.minGlyphHeight && c.height <= maxH && c.width <= c.height * 1.6 && c.area >= 10) {
      // Frames and bezels are long thin boxes: reject components that are mostly empty or mostly solid.
      const fill = c.area / (c.width * c.height);
      if (fill > 0.93 && c.width > 3 && c.height > 3 && c.width / c.height > 0.6) continue;
      for (const part of splitWide(mask, labels, c)) {
        const g = classifyComponent(mask, labels, c.label, part);
        glyphs.push({ x: part.x, y: part.y, w: part.width, h: part.height, cx: part.x + part.width / 2, cy: part.y + part.height / 2, g, retry: (r) => classifyComponent(mask, labels, c.label, r) });
      }
    } else if (c.height >= cfg.minGlyphHeight && c.height <= maxH && c.width > c.height * 1.6 && c.width <= c.height * 6 && c.area >= 20) {
      // A whole lowercase word merged into one blob ("miles"): not classified, only used as unit evidence.
      words.push({ x: c.x, y: c.y, w: c.width, h: c.height, cx: c.x + c.width / 2, cy: c.y + c.height / 2, g: WORD_GUESS, retry: () => WORD_GUESS, isWord: true });
    } else if (c.height >= 2 && c.width >= 2 && c.height <= cfg.minGlyphHeight * 1.6 && c.width <= cfg.minGlyphHeight * 1.6 && c.area >= 4) {
      dots.push({ x: c.x, y: c.y, w: c.width, h: c.height, cx: c.x + c.width / 2, cy: c.y + c.height / 2 });
    }
  }
  const runs = groupRuns(glyphs);
  const out: OdometerCandidate[] = [];
  for (const run of runs) {
    out.push(...readRun(run, glyphs.concat(words), dots, polarity, cfg, mask.height));
  }
  return out;
}

/** Group glyphs into lines: similar height, aligned centres, small gaps. */
function groupRuns(glyphs: Glyph[]): Glyph[][] {
  const order = glyphs.map((_, i) => i).sort((a, b) => glyphs[a].x - glyphs[b].x);
  const parent = glyphs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let ai = 0; ai < order.length; ai++) {
    const a = glyphs[order[ai]];
    for (let bi = ai + 1; bi < order.length; bi++) {
      const b = glyphs[order[bi]];
      const gap = b.x - (a.x + a.w);
      if (gap > a.h * 1.0) break;
      const hr = a.h / b.h;
      if (hr < 0.62 || hr > 1.6) continue;
      if (Math.abs(a.cy - b.cy) > 0.3 * Math.max(a.h, b.h)) continue;
      parent[find(order[ai])] = find(order[bi]);
    }
  }
  const groups = new Map<number, Glyph[]>();
  glyphs.forEach((g, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(g);
  });
  return [...groups.values()].map((g) => g.sort((p, q) => p.x - q.x)).filter((g) => g.length >= 2);
}

const isDigit = (c: string) => c >= '0' && c <= '9';

/**
 * A glyph as a digit candidate. Digits in condensed or odd fonts often lose to 'other'
 * (letters such as Z, S, B look like 2, 5, 8), so inside a run a glyph also counts as a
 * digit when the digit classes together hold enough probability. Its confidence is then
 * discounted by how much probability went to 'other'.
 */
function digitView(g: Glyph): { digit: string | null; conf: number } {
  const probs = g.g.probs;
  let dsum = 0, best = 0;
  for (let d = 0; d < 10; d++) { dsum += probs[d]; if (probs[d] > probs[best]) best = d; }
  if (isDigit(g.g.cls)) return { digit: g.g.cls, conf: probs[best] };
  if (g.g.cls === 'other' && dsum >= 0.3) return { digit: String(best), conf: (probs[best] / dsum) * Math.min(1, dsum * 2) };
  return { digit: null, conf: 0 };
}

function readRun(run: Glyph[], all: Glyph[], dots: Dot[], polarity: OdometerCandidate['polarity'], cfg: OdometerConfig, imageHeight: number): OdometerCandidate[] {
  const h = run.reduce((s, g) => s + g.h, 0) / run.length;
  const base = run.reduce((s, g) => s + g.y + g.h, 0) / run.length;
  // Separators between neighbours (and just after the last glyph): '.' sits on the baseline, ':' is two dots.
  const sepAfter: Array<'.' | ':' | ''> = run.map((g, i) => {
    const x0 = g.x + g.w - 1;
    const x1 = i + 1 < run.length ? run[i + 1].x + 1 : g.x + g.w + h * 0.35;
    const inGap = dots.filter((d) => d.cx >= x0 && d.cx <= x1 && d.w >= h * 0.1 && d.h >= h * 0.1);
    const lows = inGap.filter((d) => d.cy > base - h * 0.3 && d.cy < base + h * 0.35);
    const highs = inGap.filter((d) => d.cy < base - h * 0.45 && d.cy > base - h * 1.1);
    // A colon is two dots stacked in the same column; the dot of an "i" does not count.
    if (i + 1 < run.length && lows.some((l) => highs.some((u) => Math.abs(l.cx - u.cx) < h * 0.25))) return ':';
    if (lows.length) return '.';
    return '';
  });
  // Characters of the run; letters we do not care about become '_'.
  const medH = [...run].map((g) => g.h).sort((a, b) => a - b)[Math.floor(run.length / 2)];
  // Lowercase letters (the "mi" after a number) are shorter than digits and can be misread as digits.
  // A glyph taller than its neighbours has something stuck to it (a bezel edge, a dotted rule):
  // try it again with the extra height cut from the bottom or from the top, keep the better reading.
  for (const g of run) {
    if (g.h > medH * 1.04 && g.h < medH * 1.6) {
      const cut = g.h - medH;
      const alts = [g.retry({ x: g.x, y: g.y, width: g.w, height: Math.round(medH) }), g.retry({ x: g.x, y: g.y + Math.round(cut), width: g.w, height: Math.round(medH) })];
      const score = (q: GlyphGuess) => { let m = 0; for (let d = 0; d < 10; d++) m = Math.max(m, q.probs[d]); return m; };
      const best = alts.sort((a, b) => score(b) - score(a))[0];
      if (score(best) > score(g.g) + 0.2) g.g = best;
    }
  }
  const views = run.map(digitView);
  const ch = run.map((g, gi) => (g.h < medH * 0.8 ? '_' : views[gi].digit !== null ? views[gi].digit! : g.g.cls === 'D' ? 'D' : g.g.cls === 'm' ? 'm' : g.g.cls === 'k' ? 'k' : '_'));
  const out: OdometerCandidate[] = [];
  let i = 0;
  while (i < run.length) {
    if (!isDigit(ch[i])) { i++; continue; }
    let j = i;
    while (j + 1 < run.length && isDigit(ch[j + 1]) && sepAfter[j] === '') j++;
    // "ODO" label: the final O of the label classes as a zero and sits at the start of this segment.
    let hasLabel = false;
    let segStart = i;
    if (ch[i - 1] === 'D' && isDigit(ch[i - 2] ?? '_')) { hasLabel = true; segStart = i + 1; }
    else if (ch[i - 1] === '_' && ch[i - 2] === 'D') hasLabel = true;
    if (!hasLabel && labelLeftOf(run[i], all)) hasLabel = true;
    if (segStart > j) { i = j + 1; continue; }
    const digitGlyphs = run.slice(segStart, j + 1);
    const digits = ch.slice(segStart, j + 1).join('');
    const notes: string[] = [];
    const before = sepAfter[i - 1];
    const after = sepAfter[j];
    if (after === '.' && before !== '.' && before !== ':' && !hasLabel) {
      // A decimal number: a trip meter ("123.4 mi"), unless the unit says it is a rate (mpg, mph).
      let k = j + 1;
      while (k + 1 < run.length && isDigit(ch[k + 1]) && sepAfter[k] === '') k++;
      const frac = isDigit(ch[j + 1] ?? '_') ? k - j : 0;
      const whole = digits.length;
      if (frac >= 1 && frac <= 2 && whole >= 1 && whole <= 5 && sepAfter[k] !== '.' && sepAfter[k] !== ':') {
        const hardUnit = unitAfter(run, ch, k, all, h);
        const tripUnit = hardUnit ?? softUnitAfter(run[k], all, h);
        const minT = Math.min(...views.slice(segStart, k + 1).map((v) => v.conf));
        const gl = run.slice(segStart, k + 1);
        if ((tripUnit === 'mi' || tripUnit === 'km') && minT >= 0.7 && h <= imageHeight * cfg.maxUnlabelledHeightFraction && h >= imageHeight * cfg.minTripHeightFraction && evenGlyphs(gl) && properDot(run[j], run[j + 1], dots, h, base)) {
          const text = ch.slice(segStart, j + 1).join('') + '.' + ch.slice(j + 1, k + 1).join('');
          const bx0 = Math.min(...gl.map((g) => g.x)), by0 = Math.min(...gl.map((g) => g.y));
          const bx1 = Math.max(...gl.map((g) => g.x + g.w)), by1 = Math.max(...gl.map((g) => g.y + g.h));
          out.push({
            kind: 'trip', digits: text, value: Number(text), unit: tripUnit, hasLabel: false, minDigitP: minT, score: 2 + minT,
            box: { x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 }, polarity, ambiguousDigits: [], notes: ['trip meter'],
          });
        }
        i = k + 1; continue;
      }
    }
    if (before === '.' || before === ':' || after === '.' || after === ':') { i = j + 1; continue; }
    if (digits.length < 3 || digits.length > 6) { i = j + 1; continue; }
    if (looksLikeSegmentNoise(digits)) { i = j + 1; continue; }
    // Unit to the right: m (mi/miles) or k (km). "mph"/"mpg" start with m too: the next glyph decides.
    const unit = unitAfter(run, ch, j, all, h);
    if (unit === 'rate') { i = j + 1; continue; }
    if (digits.length < 5 && !hasLabel) { i = j + 1; continue; }
    // Without an ODO label, text this large is a 7-segment pump display (its fragments read as digits), not a dashboard.
    if (!hasLabel && h > imageHeight * cfg.maxUnlabelledHeightFraction) { i = j + 1; continue; }
    if (!hasLabel && !unit && minPOf(views, segStart, j) < 0.8) { i = j + 1; continue; }
    const minP = Math.min(...views.slice(segStart, j + 1).map((v) => v.conf));
    const x0 = Math.min(...digitGlyphs.map((g) => g.x)), y0 = Math.min(...digitGlyphs.map((g) => g.y));
    const x1 = Math.max(...digitGlyphs.map((g) => g.x + g.w)), y1 = Math.max(...digitGlyphs.map((g) => g.y + g.h));
    const ambiguous: OdometerCandidate['ambiguousDigits'] = [];
    digitGlyphs.forEach((g, k) => {
      if (g.g.unstable && !ambiguous.some((a) => a.index === k)) ambiguous.push({ index: k, alternative: g.g.bestDigit });
      const sorted = g.g.probs.slice(0, 10).map((p, d) => ({ p, d })).sort((a, b) => b.p - a.p);
      if (sorted[1].p > 0.25 && sorted[1].p > sorted[0].p * 0.35) ambiguous.push({ index: k, alternative: String(sorted[1].d) });
    });
    const score = (hasLabel ? 3 : 0) + (unit ? 2 : 0) + (digits.length >= 5 && digits.length <= 6 ? 1 : 0) + minP;
    out.push({
      kind: 'odometer', digits, value: Number(digits), unit: unit as 'mi' | 'km' | null, hasLabel, minDigitP: minP, score,
      box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, polarity, ambiguousDigits: ambiguous, notes,
    });
    i = j + 1;
  }
  return out;
}

/** "ODO" to the left on the same line: three glyphs 0 D 0 (O reads as zero) with small gaps. */
function labelLeftOf(first: Glyph, all: Glyph[]): boolean {
  const h = first.h;
  const left = all
    .filter((g) => g.x + g.w <= first.x + 1 && first.x - (g.x + g.w) < h * 7 && Math.abs(g.cy - first.cy) < h * 0.5 && g.h > h * 0.6 && g.h < h * 1.5)
    .sort((a, b) => b.x - a.x);
  // walk leftwards over glyphs that belong to one word (small gaps)
  const word: Glyph[] = [];
  let prevX = Infinity;
  for (const g of left) {
    if (word.length && prevX - (g.x + g.w) > h * 0.55) break;
    word.push(g); prevX = g.x;
    if (word.length === 3) break;
  }
  if (word.length < 3) return false;
  const [c, b, a] = word; // right-to-left: O, D, O
  // The O of "ODO" is rounder than a zero and may class as 'other': accept any round glyph beside a D.
  const zero = (g: Glyph) => g.g.cls === '0' || g.g.probs[0] > 0.1 || (g.g.cls === 'other' && g.w / g.h > 0.55 && g.w / g.h < 1.15);
  return zero(a) && zero(c) && (b.g.cls === 'D' || b.g.probs[GLYPH_D] > 0.3);
}
const GLYPH_D = 10;

/** 'rate' means mpg / mph (letters with descenders follow the m): a fuel economy or speed, not a distance. */
function unitAfter(run: Glyph[], ch: string[], j: number, all: Glyph[], h: number): 'mi' | 'km' | 'rate' | null {
  const last = run[j];
  // Next glyph in the same run, or the nearest glyph to the right on the same line.
  const right = all.filter((g) => g.x > last.x + last.w - 1 && g.x - (last.x + last.w) < h * 2.6 && Math.abs(g.cy - last.cy) < h * 0.6 && g !== last).sort((a, b) => a.x - b.x);
  if (!right.length) return null;
  const u = right[0];
  const k = u.g.cls;
  if (k === 'k') return 'km';
  if (k === 'm') {
    // "mi" / "miles" have no descenders; "mpg" (p, g) and "mph" (p) do.
    const base = last.y + last.h;
    const tail = all.filter((g) => g.x > u.x + u.w - 1 && g.x - (u.x + u.w) < h * 1.6 && Math.abs(g.cy - last.cy) < h * 0.9 && g.h > h * 0.4 && g.h < h * 1.25 && g.w < h * 1.2);
    if (tail.some((g) => g.y + g.h > base + h * 0.22)) return 'rate';
    return 'mi';
  }
  void ch;
  return null;
}

/** The decimal point: a small, roughly square dot on the baseline between two digits. */
function properDot(a: Glyph, b: Glyph, dots: Dot[], h: number, base: number): boolean {
  return dots.some((d) => d.cx >= a.x + a.w - 1 && d.cx <= b.x + 1
    && d.cy > base - h * 0.3 && d.cy < base + h * 0.35
    && d.w >= h * 0.12 && d.w <= h * 0.45 && d.h >= h * 0.12 && d.h <= h * 0.45 && d.w / d.h >= 0.6 && d.w / d.h <= 1.7);
}

/** Digits of one number are the same height and sit on one baseline; specks and texture do not. */
function evenGlyphs(gl: Glyph[]): boolean {
  const hs = gl.map((g) => g.h), bs = gl.map((g) => g.y + g.h);
  const mh = hs.reduce((a, b) => a + b, 0) / hs.length;
  return hs.every((x) => Math.abs(x - mh) <= mh * 0.18) && Math.max(...bs) - Math.min(...bs) <= mh * 0.15;
}

/**
 * A lowercase, baseline-aligned, letter-wide glyph right after a decimal number ("mi" merged into one
 * blob, or an 'm' the classifier was unsure about). Used only for trip meters, which need a distance unit
 * but are never accepted on this evidence alone without good digits. Rates (mpg, mph) have descenders.
 */
function softUnitAfter(last: Glyph, all: Glyph[], h: number): 'mi' | null {
  const base = last.y + last.h;
  const right = all.filter((g) => g.x > last.x + last.w - 1 && g.x - (last.x + last.w) < h * 1.2 && Math.abs(g.cy - last.cy) < h * 0.9 && g !== last).sort((a, b) => a.x - b.x);
  const u = right[0];
  if (!u) return null;
  // Merged "mi" is about as tall as a digit, so width tells it from a digit (digits are narrower than tall).
  const lower = u.h >= h * 0.42 && u.h <= h * 1.12 && Math.abs(u.y + u.h - base) <= h * 0.2 && u.w / u.h >= 0.85 && u.w / u.h <= (u.isWord ? 6 : 2.2);
  if (!lower) return null;
  // Capital letters after it ("MPG") make it a word, not a unit.
  const next = all.filter((g) => g.x > u.x + u.w - 1 && g.x - (u.x + u.w) < h * 0.6 && Math.abs(g.cy - u.cy) < h * 0.6).sort((a, b) => a.x - b.x)[0];
  if (next && next.h >= h * 0.9 && next.w >= h * 0.45) return null;
  const tail = all.filter((g) => g.x > u.x + u.w - 1 && g.x - (u.x + u.w) < h * 1.6 && Math.abs(g.cy - last.cy) < h * 0.9 && g.h > h * 0.4 && g.h < h * 1.25 && g.w < h * 1.2);
  if (tail.some((g) => g.y + g.h > base + h * 0.22)) return null;
  return 'mi';
}

/** Alternating or near-constant digits ("89894", "80808") are what the segments of a 7-segment display produce. */
function looksLikeSegmentNoise(digits: string): boolean {
  const distinct = new Set(digits).size;
  let changes = 0;
  for (let k = 1; k < digits.length; k++) if (digits[k] !== digits[k - 1]) changes++;
  return distinct <= 3 && changes >= digits.length - 1 && digits.length >= 5 && !/^(\d)\1*$/.test(digits);
}

function minPOf(views: Array<{ conf: number }>, a: number, b: number): number {
  return Math.min(...views.slice(a, b + 1).map((v) => v.conf));
}

function dedupe(c: OdometerCandidate[]): OdometerCandidate[] {
  const out: OdometerCandidate[] = [];
  for (const a of c.sort((p, q) => q.score - p.score)) {
    const dup = out.find((b) => overlap(a.box, b.box) > 0.5);
    if (!dup) out.push(a);
  }
  return out;
}

function overlap(a: OdometerCandidate['box'], b: OdometerCandidate['box']): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return 0;
  return ((x1 - x0) * (y1 - y0)) / Math.min(a.width * a.height, b.width * b.height);
}

function decide(all: OdometerCandidate[], cfg: OdometerConfig): OdometerReading {
  const warnings: string[] = [];
  const trips = all.filter((c) => c.kind === 'trip').sort((a, b) => b.score - a.score);
  const cands = all.filter((c) => c.kind === 'odometer');
  const trip = trips[0] ?? null;
  const otherTrips = trips.filter((t) => t !== trip && t.value !== trip?.value);
  if (otherTrips.length) warnings.push(`More than one trip meter value was found (${[trip!, ...otherTrips].map((t) => t.digits).join(', ')}) - please check which one you want.`);

  const good = cands.filter((c) => c.hasLabel || c.unit);
  const pool = good.length ? good : cands;
  pool.sort((a, b) => b.score - a.score);
  if (!pool.length) {
    if (trip) {
      return { status: 'partial', best: null, candidates: [], trip, warnings: ['Only a trip meter reading was found; the odometer is not visible in this photo.', ...warnings] };
    }
    return { status: 'no_odometer', best: null, candidates: [], trip: null, warnings: ['No odometer reading was found in this photo.'] };
  }
  const best = pool[0];
  const rivals = pool.filter((c) => c !== best && c.value !== best.value && c.score >= best.score - 1);
  let status: OdometerReading['status'] = 'ok';
  if (!(best.hasLabel || best.unit)) { status = 'partial'; warnings.push('Digits found but no "ODO" label or mi/km unit next to them - please confirm.'); }
  if (best.minDigitP < cfg.minDigitP) { status = 'partial'; warnings.push('Some digits were hard to read - please check the number.'); }
  if (best.ambiguousDigits.length) { status = 'partial'; warnings.push('A digit looked like another digit - please check the number.'); }
  if (rivals.length) { status = 'partial'; warnings.push(`Another possible mileage was also found (${rivals.map((r) => r.digits).join(', ')}) - please confirm.`); }
  if (trip && otherTrips.length) status = 'partial';
  return { status, best, candidates: pool.slice(0, 5), trip, warnings };
}
