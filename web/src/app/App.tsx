import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_CONFIG } from './appConfig.ts';
import { UploadForm } from './components/UploadForm.tsx';
import { ImagePreviewGrid, ImageViewer } from './components/ImagePreview.tsx';
import { ProcessingStatus, type RunState } from './components/ProcessingStatus.tsx';
import { ResultsTable } from './components/ResultsTable.tsx';
import { OdometerTable } from './components/OdometerTable.tsx';
import { OdometerStatsPanel } from './components/OdometerStatsPanel.tsx';
import { suggestOdometerFixes } from '../services/OdometerSuggestService.ts';
import { computeOdometerStats } from '../services/OdometerStatsService.ts';
import { ManualEntry } from './components/ManualEntry.tsx';
import { ReportPanel } from './components/ReportPanel.tsx';
import { buildReport, reportToCsv } from '../services/ReportService.ts';
import { manualFillUp, type ManualEntry as ManualEntryData } from '../services/ManualEntryService.ts';
import { FuelEconomyPanel } from './components/FuelEconomyPanel.tsx';
import { computeTrips, tripsToCsv } from '../services/TripService.ts';
import { StatisticsPanel } from './components/StatisticsPanel.tsx';
import { isCorrected, type FuelField, type FuelGrade, type FuelRecord } from '../models/FuelRecord.ts';
import type { ImageProcessingService } from '../services/ImageProcessingService.ts';
import { BrowserSegmentProcessor } from '../services/BrowserSegmentProcessor.ts';
import {
  applyResult, confirmRecord, correctField, newRecord, unconfirmRecord,
} from '../services/RecordService.ts';
import { computeStatistics } from '../services/StatisticsService.ts';
import { csvCell, csvFileName, recordsToCsv } from '../services/ExportService.ts';
import { dedupeRecords, importCsv, IMPORT_LIMITS, recordKey as recordKeyOf } from '../services/ImportService.ts';
import { captureTimeOf } from '../services/CaptureTimeService.ts';
import { formatBytes, validateImageFile } from '../utils/imageValidation.ts';

let idCounter = 0;
const newId = () => `r${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function App() {
  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Files and preview URLs live outside React state: they are large and never rendered directly.
  const files = useRef(new Map<string, File>());
  const [urls, setUrls] = useState(new Map<string, string>());
  const service = useRef<ImageProcessingService | null>(null);
  const abort = useRef<AbortController | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    service.current = new BrowserSegmentProcessor(new URL('worker.js', document.baseURI));
    return () => service.current?.dispose();
  }, []);

  // Release object URLs on unmount.
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = useCallback((id: string, fn: (r: FuelRecord) => FuelRecord) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));
  }, []);

  const addFiles = (incoming: File[]) => {
    const errors: string[] = [];
    const added: FuelRecord[] = [];
    const nextUrls = new Map(urls);
    for (const f of incoming) {
      if (files.current.size + added.length >= APP_CONFIG.maxImages) {
        errors.push(`Only ${APP_CONFIG.maxImages} images can be handled at once; ${f.name} was skipped.`);
        continue;
      }
      const err = validateImageFile(f, { maxBytes: APP_CONFIG.maxBytes });
      if (err) { errors.push(err.message); continue; }
      const id = newId();
      files.current.set(id, f);
      nextUrls.set(id, URL.createObjectURL(f));
      added.push(newRecord(id, f.name, f.size));
    }
    setRejected(errors);
    setUrls(nextUrls);
    setRecords((rs) => [...rs, ...added]);
    // The capture date is read in the background; it never delays processing.
    for (const r of added) {
      const f = files.current.get(r.id);
      if (f) void captureTimeOf(f).then((c) => c && update(r.id, (x) => ({ ...x, capturedAt: c.at, capturedSource: c.source })));
    }
  };

  /** Import a CSV exported earlier. Nothing is saved by this tool: the file is the history. */
  const toggleFull = (id: string) =>
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, fullTank: !r.fullTank } : r)));

  const setDetails = (id: string, patch: { tag?: string; grade?: FuelGrade; userNote?: string }) =>
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** Returns an error message, or null when the fill-up was added. */
  const addManual = (e: ManualEntryData): string | null => {
    const res = manualFillUp(e, newId);
    if (!res.ok) return res.error;
    setRecords((rs) => [...rs, ...res.records]);
    return null;
  };

  const importFile = async (file: File) => {
    setImportNote(null);
    if (file.size > IMPORT_LIMITS.maxBytes) { setImportNote({ ok: false, text: 'That file is too large to be one of this tool\u2019s exports.' }); return; }
    const text = await file.text();
    const res = importCsv(text, newId);
    if (res.error) { setImportNote({ ok: false, text: res.error }); return; }
    const have = new Set(dedupeRecords(records).map((r) => recordKeyOf(r)));
    const fresh = res.records.filter((r) => { const k = recordKeyOf(r); if (have.has(k)) return false; have.add(k); return true; });
    const dup = res.records.length - fresh.length;
    setRecords((rs) => [...rs, ...fresh]);
    const parts = [`Imported ${fresh.length} row${fresh.length === 1 ? '' : 's'}`];
    if (dup) parts.push(`${dup} already present`);
    if (res.skipped.length) parts.push(`${res.skipped.length} skipped (${res.skipped.slice(0, 3).map((s) => `line ${s.line}: ${s.reason}`).join('; ')}${res.skipped.length > 3 ? '; …' : ''})`);
    setImportNote({ ok: fresh.length > 0 || dup > 0, text: parts.join(', ') + '.' });
  };

  const remove = (id: string) => {
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    files.current.delete(id);
    setUrls((m) => { const n = new Map(m); n.delete(id); return n; });
    setRecords((rs) => rs.filter((r) => r.id !== id));
    if (viewing === id) setViewing(null);
  };

  const clearAll = () => {
    if (!window.confirm('Remove all images and results? This cannot be undone.')) return;
    urls.forEach((u) => URL.revokeObjectURL(u));
    files.current.clear();
    setUrls(new Map());
    setRecords([]);
    setRejected([]);
  };

  /** Process the given records one at a time (controlled concurrency of 1). */
  const processIds = async (ids: string[]) => {
    const svc = service.current;
    if (!svc || !ids.length) return;
    const ac = new AbortController();
    abort.current = ac;
    setRun({ total: ids.length, done: 0, currentName: null });
    for (let i = 0; i < ids.length; i++) {
      if (ac.signal.aborted) break;
      const id = ids[i];
      const file = files.current.get(id);
      if (!file) continue;
      setRun({ total: ids.length, done: i, currentName: file.name });
      update(id, (r) => ({ ...r, status: 'processing', note: null }));
      const result = await svc.processImage(file, { signal: ac.signal, config: APP_CONFIG.processing });
      if (result.error?.code === 'cancelled') {
        update(id, (r) => ({ ...r, status: r.result ? applyResult(r, r.result).status : 'queued' }));
        break;
      }
      update(id, (r) => applyResult(r, result));
    }
    // Anything left mid-run goes back to waiting.
    setRecords((rs) => rs.map((r) => (r.status === 'processing' ? { ...r, status: 'queued' } : r)));
    abort.current = null;
    setRun(null);
  };

  const processQueued = () => processIds(records.filter((r) => r.status === 'queued').map((r) => r.id));

  const reprocess = (id: string) => {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    const hasEdits = isCorrected(r);
    if (hasEdits && !window.confirm('Reprocessing replaces your corrections for this image. Continue?')) return;
    processIds([id]);
  };

  const confirmAllDetected = () => setRecords((rs) => rs.map((r) => (r.status === 'detected' && r.kind !== 'odometer' ? confirmRecord(r) : r)));

  const exportCsv = () => {
    const blob = new Blob([recordsToCsv(records.filter((r) => r.result || r.imported || r.status === 'confirmed'))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = csvFileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const exportReport = () => {
    const blob = new Blob([reportToCsv(report, csvCell)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = csvFileName().replace(/\.csv$/, '-report.csv');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const exportTrips = () => {
    const blob = new Blob([tripsToCsv(trips)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = csvFileName().replace(/\.csv$/, '-trips.csv');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const queued = records.filter((r) => r.status === 'queued');
  // A photo whose reading is already in the imported history is not counted twice.
  const visible = useMemo(() => dedupeRecords(records), [records]);
  const hiddenDuplicates = records.length - visible.length;
  const results = visible.filter((r) => r.status !== 'queued' || r.result || r.imported);
  // Mixed uploads are separated automatically from what each photo was recognised as.
  const pumpResults = results.filter((r) => r.kind !== 'odometer' && r.kind !== 'unrecognized');
  const odometerResults = results.filter((r) => r.kind === 'odometer');
  const unrecognised = results.filter((r) => r.kind === 'unrecognized');
  const stats = useMemo(() => computeStatistics(visible), [visible]);
  const trips = useMemo(() => computeTrips(visible), [visible]);
  const odoStats = useMemo(() => computeOdometerStats(visible), [visible]);
  const report = useMemo(() => buildReport(trips), [trips]);
  const knownTags = useMemo(() => [...new Set(visible.map((r) => r.tag).filter(Boolean))].sort(), [visible]);
  const suggestions = useMemo(() => suggestOdometerFixes(visible), [visible]);
  const detectedCount = visible.filter((r) => r.status === 'detected' && r.kind !== 'odometer').length;
  const busy = run !== null;
  const viewed = viewing ? records.find((r) => r.id === viewing) : undefined;

  return (
    <>
      <header className="masthead">
        <a href="https://overlandn.com" className="back-to-main">← Back to main page</a>
        <h1>Fuel Photo Log</h1>
        <p className="muted">Read fuel pump displays and odometers from photos. Everything runs in your browser; photos are never uploaded.</p>
      </header>
      <div className="page">

      <section className="card" aria-labelledby="upload-h">
        <h2 id="upload-h">Upload your photos</h2>
        <p className="muted small">Fuel pump displays and dashboard odometers can be mixed, even a whole folder: each photo is sorted automatically.</p>
        <UploadForm onFiles={addFiles} disabled={busy} maxSizeLabel={formatBytes(APP_CONFIG.maxBytes)} />
        {rejected.length ? (
          <ul className="errors" role="alert">{rejected.map((e, i) => <li key={i}>{e}</li>)}</ul>
        ) : null}
        {queued.length ? (
          <>
            <p className="selected">Selected images: {queued.length}</p>
            <ImagePreviewGrid records={queued} urls={urls} onRemove={remove} disabled={busy} />
          </>
        ) : null}
        <div className="row-actions">
          <button type="button" className="btn btn--primary" disabled={!queued.length || busy} onClick={processQueued}>
            Process {queued.length > 1 ? `${queued.length} images` : 'images'}
          </button>
          {records.length ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={clearAll}>Clear all</button> : null}
        </div>
        {run ? <ProcessingStatus run={run} onCancel={() => abort.current?.abort()} /> : null}
        <div className="import">
          <input
            ref={importInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }}
          />
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => importInput.current?.click()}>Import earlier data (CSV)</button>
          <span className="muted small">This page saves nothing. When you are done, export your data and keep the file; import it here next time to continue from where you stopped.</span>
        </div>
        {importNote ? <p className={importNote.ok ? 'muted small' : 'errors'} role={importNote.ok ? 'status' : 'alert'}>{importNote.text}</p> : null}
        <ManualEntry onAdd={addManual} />
        <datalist id="known-tags">{knownTags.map((t) => <option key={t} value={t} />)}</datalist>
        {hiddenDuplicates ? <p className="muted small">{hiddenDuplicates} reading{hiddenDuplicates === 1 ? '' : 's'} already in your imported data {hiddenDuplicates === 1 ? 'is' : 'are'} hidden and not counted twice.</p> : null}
      </section>

      {pumpResults.length ? (
        <section className="card" aria-labelledby="results-h">
          <div className="card__head">
            <h2 id="results-h">Fuel pump photos ({pumpResults.length})</h2>
            {detectedCount ? (
              <button type="button" className="btn btn--small" onClick={confirmAllDetected}>Confirm {detectedCount} detected</button>
            ) : null}
          </div>
          <p className="muted small legend">
            <span className="dot dot--high" /> confident <span className="dot dot--medium" /> check <span className="dot dot--low" /> unsure
            · <span className="tag tag--user">edited</span> your value <span className="tag tag--derived">calc</span> amount ÷ volume.
            Click a photo to inspect what was read.
          </p>
          <ResultsTable
            records={pumpResults}
            urls={urls}
            busy={busy}
            onEdit={(id, field: FuelField, v) => update(id, (r) => correctField(r, field, v))}
            onConfirm={(id, c) => update(id, (r) => (c ? confirmRecord(r) : unconfirmRecord(r)))}
            onReprocess={reprocess}
            onRemove={remove}
            onView={setViewing}
          />
        </section>
      ) : null}

      {odometerResults.length ? (
        <section className="card" aria-labelledby="odo-h">
          <h2 id="odo-h">Odometer photos ({odometerResults.length})</h2>
          <p className="muted small">Read from the dashboard. The odometer (total mileage) is told apart from the trip meter (a smaller distance since the last reset). Mileage is accepted only next to an “ODO” label or a mi/km unit; anything less certain is marked for you to check.</p>
          <OdometerTable
            records={odometerResults}
            suggestions={suggestions}
            urls={urls}
            busy={busy}
            onEdit={(id, field, v) => update(id, (r) => correctField(r, field, v))}
            onConfirm={(id, c) => update(id, (r) => (c ? confirmRecord(r) : unconfirmRecord(r)))}
            onReprocess={reprocess}
            onRemove={remove}
            onView={setViewing}
          />
        </section>
      ) : null}

      {pumpResults.length && odometerResults.length ? (
        <section className="card" aria-labelledby="eco-h">
          <h2 id="eco-h">Fuel economy</h2>
          <FuelEconomyPanel summary={trips} onExport={exportTrips} onToggleFull={toggleFull} onDetails={setDetails} />
        </section>
      ) : null}

      {report.fillUps > 0 ? (
        <section className="card report-card" aria-labelledby="rep-h">
          <h2 id="rep-h">Report</h2>
          <ReportPanel report={report} onCsv={exportReport} />
        </section>
      ) : null}

      {unrecognised.length ? (
        <section className="card" aria-labelledby="unrec-h">
          <h2 id="unrec-h">Not recognised ({unrecognised.length})</h2>
          <p className="muted small">These photos were not recognised as a fuel pump display or an odometer, so nothing was filled in.</p>
          <ul className="unrecognised">
            {unrecognised.map((r) => (
              <li key={r.id}>
                <button type="button" className="img-cell" onClick={() => setViewing(r.id)} title="Look at the photo">
                  <img src={urls.get(r.id)} alt="" loading="lazy" />
                  <span className="img-cell__name">{r.fileName}</span>
                </button>
                <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={() => reprocess(r.id)}>Try again</button>
                <button type="button" className="icon-btn" aria-label={`Remove ${r.fileName}`} onClick={() => remove(r.id)}>×</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {pumpResults.length ? (
        <section className="card" aria-labelledby="stats-h">
          <h2 id="stats-h">Statistics</h2>
          <StatisticsPanel stats={stats} onExport={exportCsv} canExport={results.some((r) => r.result || r.imported)} />
        </section>
      ) : null}

      {odometerResults.length ? (
        <section className="card" aria-labelledby="odo-stats-h">
          <h2 id="odo-stats-h">Mileage statistics</h2>
          <OdometerStatsPanel stats={odoStats} onExport={pumpResults.length ? undefined : exportCsv} />
        </section>
      ) : null}

      <footer className="support">
        <p>If this tool was useful, consider supporting it.</p>
        {APP_CONFIG.supportUrl ? (
          <a className="btn btn--primary btn--link" href={APP_CONFIG.supportUrl} target="_blank" rel="noopener noreferrer">Support this tool</a>
        ) : (
          <button type="button" className="btn" disabled title="Coming soon">Support this tool</button>
        )}
      </footer>

      {viewed && urls.get(viewed.id) ? (
        <ImageViewer record={viewed} url={urls.get(viewed.id)!} onClose={() => setViewing(null)} />
      ) : null}
    </div>
    </>
  );
}
