import type { OdometerStats } from '../../services/OdometerStatsService.ts';

interface Props {
  stats: OdometerStats;
  /** Shown when there is no pump statistics panel (and so no other export button). */
  onExport?: () => void;
}

const num = (v: number | null, d = 0) => (v === null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

/** Mileage statistics from odometer photos alone. */
export function OdometerStatsPanel({ stats: s, onExport }: Props) {
  const unit = s.unit ?? 'mi';
  const needsMore = s.distance === null;
  return (
    <div>
      <dl className="stats__counts">
        <div className="stat"><dt>Readings</dt><dd>{s.readings}</dd></div>
        <div className="stat"><dt>Distance</dt><dd>{num(s.distance)} <span className="muted small">{unit}</span></dd></div>
        <div className="stat"><dt>Per day</dt><dd>{num(s.perDay, 1)} <span className="muted small">{unit}</span></dd></div>
        <div className="stat"><dt>Per month</dt><dd>{num(s.perMonth)} <span className="muted small">{unit}</span></dd></div>
        <div className="stat"><dt>Per year (projected)</dt><dd>{num(s.perYear)} <span className="muted small">{unit}</span></dd></div>
      </dl>

      <table className="stats__totals">
        <tbody>
          <tr><th scope="row">First reading</th><td className="num">{s.first ? `${num(s.first.value)} on ${s.first.date}` : '–'}</td></tr>
          <tr><th scope="row">Latest reading</th><td className="num">{s.last ? `${num(s.last.value)} on ${s.last.date}` : '–'}</td></tr>
          <tr><th scope="row">Time covered</th><td className="num">{s.days === null ? '–' : `${num(s.days, 0)} days`}</td></tr>
          <tr><th scope="row">Average time between readings</th><td className="num">{s.averageDaysBetween === null ? '–' : `${num(s.averageDaysBetween, 1)} days`}</td></tr>
          {s.untimed ? <tr><th scope="row">Range of all readings</th><td className="num">{num(s.min)} – {num(s.max)}</td></tr> : null}
        </tbody>
      </table>

      {needsMore ? (
        <p className="muted small">
          Rates need at least two confirmed or detected readings with photo times on different days.
          {s.untimed ? ` ${s.untimed} reading${s.untimed === 1 ? ' has' : 's have'} no photo time (only a file date), so ${s.untimed === 1 ? 'it is' : 'they are'} not used for rates.` : ''}
        </p>
      ) : (
        <p className="muted small">
          Ordered by the time each photo was taken. The yearly figure is the average rate over the period shown, projected to 12 months, so it is rough when the period is short.
          {s.untimed ? ` ${s.untimed} reading${s.untimed === 1 ? ' has' : 's have'} no photo time and ${s.untimed === 1 ? 'is' : 'are'} not used.` : ''}
        </p>
      )}
      {s.inconsistent.length ? (
        <p className="note">
          Left out because an odometer cannot go down: {s.inconsistent.map((p) => `${p.value} (${p.fileName}, ${p.date})`).join(', ')}. Check these readings.
        </p>
      ) : null}
      {onExport ? <button type="button" className="btn" onClick={onExport}>Export CSV</button> : null}
    </div>
  );
}
