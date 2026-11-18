import { useEffect, useState } from 'react';
import { effectiveValue, valueSource, type FuelRecord, type RecordStatus } from '../../models/FuelRecord.ts';
import { canConfirm } from '../../services/RecordService.ts';
import { formatFixed, parseNumber } from '../../utils/numberFormatting.ts';

interface Props {
  records: FuelRecord[];
  urls: Map<string, string>;
  busy: boolean;
  onEdit: (id: string, field: 'odometer' | 'trip', value: number | null) => void;
  onConfirm: (id: string, confirmed: boolean) => void;
  onReprocess: (id: string) => void;
  onRemove: (id: string) => void;
  onView: (id: string) => void;
}

const STATUS_LABEL: Record<RecordStatus, string> = {
  queued: 'Waiting', processing: 'Processing…', review: 'Review', detected: 'Detected', confirmed: 'Confirmed', failed: 'Failed',
};

/** Odometer photos: one editable mileage per photo, same review workflow as pump photos. */
export function OdometerTable(props: Props) {
  const { records, urls, busy } = props;
  return (
    <div className="table-wrap">
      <table className="results">
        <thead>
          <tr>
            <th>Image</th>
            <th>Date</th>
            <th className="num">Odometer</th>
            <th className="num" title="Distance since the trip meter was last reset. Not used as mileage.">Trip meter</th>
            <th>Status</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className={`row row--${r.status}`}>
              <td data-label="Image">
                {r.imported ? (
                  <span className="img-cell img-cell--none"><span className="img-cell__name">{r.fileName}</span> <span className="tag">imported</span></span>
                ) : (
                  <button type="button" className="img-cell" onClick={() => props.onView(r.id)} title="Inspect the original photo">
                    <img src={urls.get(r.id)} alt="" loading="lazy" />
                    <span className="img-cell__name">{r.fileName}</span>
                  </button>
                )}
              </td>
              <td data-label="Date">
                {r.capturedAt ? <span>{r.capturedAt.slice(0, 10)}{r.capturedSource === 'file' ? <span className="muted"> (file date)</span> : null}</span> : <span className="muted">–</span>}
              </td>
              <td data-label="Odometer" className="num">
                <OdometerCell record={r} field="odometer" onChange={(v) => props.onEdit(r.id, 'odometer', v)} />
              </td>
              <td data-label="Trip meter" className="num">
                <OdometerCell record={r} field="trip" onChange={(v) => props.onEdit(r.id, 'trip', v)} />
              </td>
              <td data-label="Status">
                <span className={`badge badge--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                {r.note ? <div className="note" title={r.note}>{r.note}</div> : null}
              </td>
              <td className="actions">
                {r.status === 'confirmed' ? (
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => props.onConfirm(r.id, false)}>Unconfirm</button>
                ) : (
                  <button type="button" className="btn btn--small" disabled={!canConfirm(r) || r.status === 'processing'} onClick={() => props.onConfirm(r.id, true)}>Confirm</button>
                )}
                <button type="button" className="btn btn--small btn--ghost" disabled={busy || r.imported} onClick={() => props.onReprocess(r.id)}>Reprocess</button>
                <button type="button" className="icon-btn" aria-label={`Remove ${r.fileName}`} onClick={() => props.onRemove(r.id)}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OdometerCell({ record, field, onChange }: { record: FuelRecord; field: 'odometer' | 'trip'; onChange: (v: number | null) => void }) {
  const decimals = field === 'trip' ? 1 : 0;
  const f = record[field];
  const eff = effectiveValue(f);
  const source = valueSource(f);
  const shown = formatFixed(eff, decimals);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(shown); setInvalid(false); }, [shown]);
  const level = f.confidence >= 0.85 ? 'high' : f.confidence >= 0.6 ? 'medium' : 'low';

  const commit = () => {
    if (draft.trim() === '') { setInvalid(false); if (f.corrected !== null) onChange(null); else setDraft(shown); return; }
    const n = parseNumber(draft.replace(/[\s,]/g, ''));
    if (n === null || (decimals === 0 && !Number.isInteger(n)) || Math.round(n * 10 ** decimals) / 10 ** decimals !== n) { setInvalid(true); return; }
    setInvalid(false);
    if (formatFixed(n, decimals) !== shown) onChange(n); else setDraft(shown);
  };

  const info = f.detected !== null ? `Detected: ${f.detectedText} (confidence ${Math.round(f.confidence * 100)}%)` : 'Not detected';
  return (
    <div className={`field field--${source}${invalid ? ' field--invalid' : ''}`} title={source === 'user' ? `Edited. ${info}` : info}>
      {source === 'detected' ? <span className={`dot dot--${level}`} aria-hidden="true" /> : null}
      <input
        inputMode={decimals ? 'decimal' : 'numeric'}
        aria-label={`${field === 'trip' ? 'Trip meter' : 'Odometer'} for ${record.fileName}`}
        aria-invalid={invalid}
        value={draft}
        placeholder="—"
        disabled={record.status === 'processing' || record.status === 'queued'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {record.odometerUnit && f.detected !== null ? <span className="muted">{record.odometerUnit}</span> : null}
      {source === 'user' ? <span className="tag tag--user">edited</span> : null}
      {source === 'detected' && level !== 'high' ? <span className="tag tag--warn">check</span> : null}
    </div>
  );
}
