interface Point { label: string; value: number }
interface Props {
  title: string;
  points: Point[];
  kind: 'bars' | 'line';
  /** Decimals for the value labels. */
  decimals: number;
  unitLabel: string;
}

const W = 520, H = 170, PAD = { l: 44, r: 12, t: 12, b: 28 };

/** A small dependency-free chart. Colours come from the page theme; every point also has a text label for screen readers. */
export function MiniChart({ title, points, kind, decimals, unitLabel }: Props) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const lo = kind === 'bars' ? 0 : Math.min(...vals) * 0.95;
  const hi = Math.max(...vals) * 1.05 || 1;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * (kind === 'bars' ? i + 0.5 : i)) / (kind === 'bars' ? points.length : points.length - 1);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
  const barW = Math.min(36, ((W - PAD.l - PAD.r) / points.length) * 0.7);
  const ticks = [lo, (lo + hi) / 2, hi];
  const every = Math.ceil(points.length / 6);
  return (
    <figure className="chart">
      <figcaption>{title} <span className="muted small">({unitLabel})</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value.toFixed(decimals)}`).join(', ')}`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart__axis">{t.toFixed(decimals)}</text>
          </g>
        ))}
        {kind === 'bars'
          ? points.map((p, i) => <rect key={i} x={x(i) - barW / 2} y={y(p.value)} width={barW} height={y(lo) - y(p.value)} className="chart__bar"><title>{`${p.label}: ${p.value.toFixed(decimals)}`}</title></rect>)
          : <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} className="chart__line" fill="none" />}
        {kind === 'line' ? points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" className="chart__dot"><title>{`${p.label}: ${p.value.toFixed(decimals)}`}</title></circle>) : null}
        {points.map((p, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="chart__axis">{p.label.slice(5)}</text> : null))}
      </svg>
    </figure>
  );
}
