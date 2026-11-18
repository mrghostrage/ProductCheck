// Recent checks. Kept only on this phone, like personal rules, so the Scan screen can show
// what you looked at before without an account.
import Storage from 'expo-sqlite/kv-store';

import type { Report } from './types';

export interface HistoryEntry {
  id: string;
  checkedAt: string;
  report: Report;
  saved: boolean;
}

const KEY = 'history.v1';
const MAX = 20;

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await Storage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    // Newest first, so keep the first of any repeats (older lists may hold some).
    return list.filter((e, i) => list.findIndex((x) => sameProduct(x.report, e.report)) === i);
  } catch {
    return [];
  }
}

// Same product checked again moves to the top instead of appearing twice.
function sameProduct(a: Report, b: Report) {
  // Older entries hold the barcode as printed, newer ones the server's zero-padded key: compare without leading zeros.
  if (a.product.gtin && b.product.gtin) return a.product.gtin.replace(/^0+/, '') === b.product.gtin.replace(/^0+/, '');
  const url = (r: Report) => r.sources.find((s) => s.url)?.url ?? null;
  if (url(a) && url(b)) return url(a) === url(b);
  // No barcode or link (demo products, label-only photos): fall back to brand and name.
  const id = (r: Report) => (r.product.name ? `${r.product.brand ?? ''}|${r.product.name}`.toLowerCase() : null);
  return !!id(a) && id(a) === id(b);
}

export async function addToHistory(report: Report, saved: boolean) {
  const list = (await loadHistory()).filter((e) => !sameProduct(e.report, report));
  const entry: HistoryEntry = { id: `${Date.now()}`, checkedAt: new Date().toISOString(), report, saved };
  await Storage.setItem(KEY, JSON.stringify([entry, ...list].slice(0, MAX)));
}

// Short age for a recent card: "Now", "5m", "3h", then the weekday, then the date.
export function timeAgo(iso: string, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'Now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = new Date(iso);
  return h < 24 * 6 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
