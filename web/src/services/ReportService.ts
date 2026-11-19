/**
 * A report over everything loaded: totals, one line per month, one line per tag, the best and worst
 * trips and the series behind the charts. Pure: it only reads the TripSummary.
 *
 * Only trips without a "check" flag count (the same rule as the fuel economy figures); money spent is
 * counted over every paired fill-up, because it was spent whether or not its trip could be checked.
 */
import type { FillUp, Trip, TripSummary } from './TripService.ts';

export interface PeriodLine {
  /** "2026-10" for months, the tag text for tags. */
  key: string;
  fillUps: number;
  volume: number;
  amount: number;
  pricePerUnit: number | null;
  trips: number;
  distance: number;
  efficiency: number | null;
  costPerDistance: number | null;
}

export interface Report {
  unit: 'mi' | 'km';
  from: string | null;
  to: string | null;
  fillUps: number;
  volume: number;
  amount: number;
  pricePerUnit: number | null;
  trips: number;
  distance: number;
  efficiency: number | null;
  costPerDistance: number | null;
  months: PeriodLine[];
  tags: PeriodLine[];
  best: Trip | null;
  worst: Trip | null;
  /** Chart series, in time order. */
  efficiencySeries: Array<{ date: string; value: number; tag: string }>;
  priceSeries: Array<{ date: string; value: number }>;
}

/** The tag of a trip: the tag of the fill-up that ended it, else the first tagged fill-up since the last full one. */
export function tripTag(t: Trip): string {
  return t.to.tag || t.fills.find((f) => f.tag)?.tag || '';
}

function line(key: string, fills: FillUp[], trips: Trip[]): PeriodLine {
  const volume = fills.reduce((s, f) => s + f.volume, 0);
  const amount = fills.reduce((s, f) => s + f.amount, 0);
  const distance = trips.reduce((s, t) => s + t.distance, 0);
  const tv = trips.reduce((s, t) => s + t.volume, 0);
  const ta = trips.reduce((s, t) => s + t.amount, 0);
  return {
    key, fillUps: fills.length, volume, amount, pricePerUnit: volume > 0 ? amount / volume : null,
    trips: trips.length, distance, efficiency: tv > 0 && distance > 0 ? distance / tv : null,
    costPerDistance: distance > 0 ? ta / distance : null,
  };
}

export function buildReport(s: TripSummary): Report {
  const good = s.trips.filter((t) => t.issues.length === 0);
  const unit = s.trips.find((t) => t.unit)?.unit ?? s.fillUps.find((f) => f.unit)?.unit ?? 'mi';

  const months = new Map<string, { fills: FillUp[]; trips: Trip[] }>();
  const slot = (k: string) => { let v = months.get(k); if (!v) { v = { fills: [], trips: [] }; months.set(k, v); } return v; };
  for (const f of s.fillUps) slot(f.date.slice(0, 7)).fills.push(f);
  for (const t of good) slot(t.to.date.slice(0, 7)).trips.push(t);

  const tags = new Map<string, { fills: FillUp[]; trips: Trip[] }>();
  for (const t of good) {
    const k = tripTag(t) || '(no tag)';
    let v = tags.get(k); if (!v) { v = { fills: [], trips: [] }; tags.set(k, v); }
    v.trips.push(t); v.fills.push(...t.fills);
  }

  const ranked = good.filter((t) => t.efficiency !== null).sort((a, b) => b.efficiency! - a.efficiency!);
  const total = line('all', s.fillUps, good);
  return {
    unit,
    from: s.fillUps[0]?.date ?? null,
    to: s.fillUps[s.fillUps.length - 1]?.date ?? null,
    fillUps: s.fillUps.length, volume: total.volume, amount: total.amount, pricePerUnit: total.pricePerUnit,
    trips: good.length, distance: total.distance, efficiency: total.efficiency, costPerDistance: total.costPerDistance,
    months: [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => line(k, v.fills, v.trips)),
    tags: [...tags.entries()].sort((a, b) => b[1].trips.length - a[1].trips.length).map(([k, v]) => line(k, v.fills, v.trips)),
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    efficiencySeries: good.filter((t) => t.efficiency !== null).map((t) => ({ date: t.to.date, value: t.efficiency!, tag: tripTag(t) })),
    priceSeries: s.fillUps.filter((f) => f.volume > 0).map((f) => ({ date: f.date, value: f.amount / f.volume })),
  };
}

/** The report as CSV (months, then tags), for a spreadsheet. */
export function reportToCsv(r: Report, csvCell: (v: string) => string): string {
  const head = ['section', 'period_or_tag', 'fill_ups', 'volume', 'amount', 'price_per_unit', 'trips', `distance_${r.unit}`, 'efficiency', `cost_per_${r.unit}`];
  const f = (v: number | null, d: number) => (v === null ? '' : v.toFixed(d));
  const row = (sec: string, l: PeriodLine) => [sec, l.key, String(l.fillUps), f(l.volume, 3), f(l.amount, 2), f(l.pricePerUnit, 3), String(l.trips), f(l.distance, 0), f(l.efficiency, 2), f(l.costPerDistance, 3)].map(csvCell).join(',');
  return [head.join(','), ...r.months.map((m) => row('month', m)), ...r.tags.map((t) => row('tag', t))].join('\r\n') + '\r\n';
}
