import type { Report, PeriodLine } from '../../services/ReportService.ts';
import { MiniChart } from './MiniChart.tsx';

interface Props { report: Report; onCsv: () => void }

const fmt = (v: number | null, d: number) => (v === null ? '–' : v.toFixed(d));

function Lines({ title, lines, report }: { title: string; lines: PeriodLine[]; report: Report }) {
  if (!lines.length) return null;
  const eff = report.unit === 'km' ? 'km/unit' : 'mpg';
  return (
    <div className="table-wrap">
      <table className="results">
        <thead>
          <tr>
            <th>{title}</th><th className="num">Fill-ups</th><th className="num">Fuel</th><th className="num">Spent</th>
            <th className="num">Price / unit</th><th className="num">Distance</th><th className="num">{eff}</th><th className="num">Cost / {report.unit}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="row">
              <td data-label={title}>{l.key}</td>
              <td data-label="Fill-ups" className="num">{l.fillUps}</td>
              <td data-label="Fuel" className="num">{fmt(l.volume, 1)}</td>
              <td data-label="Spent" className="num">{fmt(l.amount, 2)}</td>
              <td data-label="Price" className="num">{fmt(l.pricePerUnit, 3)}</td>
              <td data-label="Distance" className="num">{l.trips ? fmt(l.distance, 0) : '–'}</td>
              <td data-label={eff} className="num">{fmt(l.efficiency, 1)}</td>
              <td data-label="Cost" className="num">{fmt(l.costPerDistance, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Summary of everything loaded. Printable (the browser's print / save as PDF) and exportable as CSV. */
export function ReportPanel({ report, onCsv }: Props) {
  const eff = report.unit === 'km' ? 'km per fuel unit' : 'mpg';
  return (
    <div className="report">
      <p className="muted small">{report.from} to {report.to} · {report.fillUps} fill-up{report.fillUps === 1 ? '' : 's'}, {report.trips} checked trip{report.trips === 1 ? '' : 's'}</p>
      <dl className="stats__counts">
        <div className="stat"><dt>Spent</dt><dd>{fmt(report.amount, 2)}</dd></div>
        <div className="stat"><dt>Fuel bought</dt><dd>{fmt(report.volume, 1)}</dd></div>
        <div className="stat"><dt>Average price</dt><dd>{fmt(report.pricePerUnit, 3)}</dd></div>
        <div className="stat"><dt>Efficiency</dt><dd>{fmt(report.efficiency, 1)} <span className="muted small">{eff}</span></dd></div>
        <div className="stat"><dt>Cost per {report.unit}</dt><dd>{fmt(report.costPerDistance, 3)}</dd></div>
        <div className="stat"><dt>Distance</dt><dd>{fmt(report.distance, 0)} <span className="muted small">{report.unit}</span></dd></div>
      </dl>
      {report.best ? (
        <p className="small">
          Best trip: <strong>{fmt(report.best.efficiency, 1)}</strong> ({report.best.from.date} → {report.best.to.date}{report.best.to.tag ? `, ${report.best.to.tag}` : ''}).
          {report.worst ? <> Worst: <strong>{fmt(report.worst.efficiency, 1)}</strong> ({report.worst.from.date} → {report.worst.to.date}{report.worst.to.tag ? `, ${report.worst.to.tag}` : ''}).</> : null}
        </p>
      ) : null}
      <div className="charts">
        <MiniChart title="Efficiency per trip" unitLabel={eff} kind="bars" decimals={1} points={report.efficiencySeries.map((p) => ({ label: p.date, value: p.value }))} />
        <MiniChart title="Price per unit" unitLabel="per gallon or litre" kind="line" decimals={2} points={report.priceSeries.map((p) => ({ label: p.date, value: p.value }))} />
      </div>
      <Lines title="Month" lines={report.months} report={report} />
      {report.tags.some((t) => t.key !== '(no tag)') ? <Lines title="Tag" lines={report.tags} report={report} /> : null}
      <p className="muted small">Trips marked “check” are left out of distance and efficiency; money spent counts every paired fill-up. Tag fill-ups above to compare conditions such as towing or highway.</p>
      <div className="no-print">
        <button type="button" className="btn" onClick={() => window.print()}>Print / save as PDF</button>{' '}
        <button type="button" className="btn btn--ghost" onClick={onCsv}>Export report CSV</button>
      </div>
    </div>
  );
}
