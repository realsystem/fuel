import { ISSUE_TEXT, type TripSummary } from '../../services/TripService.ts';

interface Props {
  summary: TripSummary;
  onExport: () => void;
}

const fmt = (v: number | null, d: number) => (v === null ? '–' : v.toFixed(d));

/** Miles (or km) per fuel unit, cost per distance, and the fill-up to fill-up trips behind them. */
export function FuelEconomyPanel({ summary, onExport }: Props) {
  const { totals, trips } = summary;
  const unit = trips.find((t) => t.unit)?.unit ?? 'mi';
  const effLabel = unit === 'km' ? 'km per fuel unit' : 'mpg';
  return (
    <div>
      <dl className="stats__counts">
        <div className="stat"><dt>Efficiency</dt><dd>{fmt(totals.efficiency, 1)} <span className="muted small">{effLabel}</span></dd></div>
        <div className="stat"><dt>Cost per {unit}</dt><dd>{fmt(totals.costPerDistance, 3)}</dd></div>
        <div className="stat"><dt>Distance</dt><dd>{fmt(totals.distance, 0)} <span className="muted small">{unit}</span></dd></div>
        <div className="stat"><dt>Between fill-ups</dt><dd>{fmt(totals.averageDaysBetween, 1)} <span className="muted small">days</span></dd></div>
      </dl>
      <p className="muted small">
        {totals.trips} of {trips.length} trip{trips.length === 1 ? '' : 's'} used. Trips marked “check” are left out of these figures.
        Efficiency is the distance since the previous fill-up divided by the fuel bought at this one, so it assumes you filled up to the same level each time.
        {unit === 'mi' ? ' The figure is mpg if the pump shows gallons.' : ''}
      </p>

      {trips.length ? (
        <div className="table-wrap">
          <table className="results">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Odometer</th>
                <th className="num">Distance</th>
                <th className="num">Fuel</th>
                <th className="num">{effLabel}</th>
                <th className="num">Cost / {unit}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.from.recordId + t.to.recordId} className={t.issues.length ? 'row row--review' : 'row'}>
                  <td data-label="Date">{t.to.date}</td>
                  <td data-label="Odometer" className="num">{t.from.odometer} → {t.to.odometer}</td>
                  <td data-label="Distance" className="num">{t.distance}</td>
                  <td data-label="Fuel" className="num">{t.volume.toFixed(3)}</td>
                  <td data-label={effLabel} className="num">{fmt(t.efficiency, 1)}</td>
                  <td data-label="Cost" className="num">{fmt(t.costPerDistance, 3)}</td>
                  <td data-label="Status">
                    {t.issues.length ? (
                      <>
                        <span className="badge badge--review">Check</span>
                        <div className="note">{t.issues.map((i) => ISSUE_TEXT[i]).join(' ')}</div>
                      </>
                    ) : (
                      <span className={`badge badge--${t.provisional ? 'detected' : 'confirmed'}`}>{t.provisional ? 'Unconfirmed' : 'OK'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Two or more fill-ups, each with an odometer photo taken within a few hours of it, are needed to work out a trip.</p>
      )}

      {summary.unpairedFillUps.length || summary.unpairedOdometers.length ? (
        <p className="muted small">
          {summary.unpairedFillUps.length ? `${summary.unpairedFillUps.length} pump photo${summary.unpairedFillUps.length === 1 ? '' : 's'} could not be matched to an odometer photo (${summary.unpairedFillUps.filter((u) => u.reason === 'no_capture_time').length} had no photo time). ` : ''}
          {summary.unpairedOdometers.length ? `${summary.unpairedOdometers.length} odometer photo${summary.unpairedOdometers.length === 1 ? '' : 's'} had no fill-up near it in time.` : ''}
          {' '}Photos are matched by the time they were taken; only confirmed or detected readings are used.
        </p>
      ) : null}
      <button type="button" className="btn" onClick={onExport} disabled={!trips.length}>Export trips CSV</button>
    </div>
  );
}
