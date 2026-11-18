/**
 * Deterministic synthetic photos of things that are NOT fuel pumps, used to
 * check that the processor refuses to invent numbers. A seeded generator
 * keeps them reproducible; no image files are needed.
 */
export interface Rgba { data: Uint8Array; width: number; height: number }

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w: number, h: number, bg: (x: number, y: number) => [number, number, number]): Rgba {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = bg(x, y), i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function rect(img: Rgba, x0: number, y0: number, w: number, h: number, c: [number, number, number]): void {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y0 + h)); y++)
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x0 + w)); x++) {
      const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
    }
}

export function noiseScene(seed: number, w = 640, h = 480): Rgba {
  const r = rng(seed);
  return canvas(w, h, () => { const v = Math.floor(r() * 256); return [v, v, v]; });
}

/** Forest with tilted trunks, foliage blotches and one or two truck-like boxes. */
export function forestScene(seed: number, w = 800, h = 600): Rgba {
  const r = rng(seed);
  const img = canvas(w, h, (_x, y) => [Math.round(205 - y * 0.08), Math.round(225 - y * 0.06), 245]);
  for (let i = 0; i < 160; i++) { // foliage
    const g = 40 + Math.floor(r() * 70);
    rect(img, r() * w, r() * h * 0.8, 20 + r() * 70, 15 + r() * 50, [g * 0.5, g, g * 0.4]);
  }
  for (let i = 0; i < 8 + Math.floor(r() * 14); i++) { // trunks: tall, dark, slightly tilted
    const x = r() * w, tw = 8 + r() * 30, tilt = (r() - 0.5) * 40, c = 25 + Math.floor(r() * 50);
    for (let y = 0; y < h; y += 4) rect(img, x + (tilt * y) / h, y, tw, 4, [c, c * 0.8, c * 0.6]);
  }
  for (let t = 0; t < 1 + Math.floor(r() * 2); t++) { // trucks
    const x = 40 + r() * (w - 380), y = h * 0.5 + r() * (h * 0.25), bw = 220 + r() * 120, bh = 90 + r() * 60;
    rect(img, x, y, bw, bh, [60 + r() * 150, 60 + r() * 150, 60 + r() * 150]);
    rect(img, x + bw * 0.62, y + 6, bw * 0.34, bh * 0.4, [170, 200, 220]);
    rect(img, x + bw * 0.12, y + bh - 8, 40, 40, [15, 15, 15]);
    rect(img, x + bw * 0.72, y + bh - 8, 40, 40, [15, 15, 15]);
  }
  return img;
}

/** A fence / blinds: evenly spaced vertical bars (look like rows of "1"). */
export function fenceScene(seed: number, w = 640, h = 480): Rgba {
  const r = rng(seed);
  const img = canvas(w, h, () => [205, 205, 205]);
  const pitch = 30 + Math.floor(r() * 50), bar = 8 + Math.floor(r() * 10);
  for (let x = 10; x < w; x += pitch) rect(img, x, 0, bar, h, [40, 40, 40]);
  return img;
}

export function checkerScene(cell: number, w = 640, h = 480): Rgba {
  return canvas(w, h, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? [30, 30, 30] : [220, 220, 220]));
}

export function blankScene(v: number, w = 640, h = 480): Rgba {
  return canvas(w, h, () => [v, v, v]);
}
