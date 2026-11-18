// Holds the report being viewed, so screens can hand it to the report screen without
// stuffing a large object into the URL.
import { router } from 'expo-router';

import { addToHistory } from './history';
import type { Report } from './types';

let current: { report: Report; saved: boolean } | null = null;

export function getCurrentReport() {
  return current;
}

// Shows a report. A fresh check also goes to the top of the recent list; reopening a recent one doesn't.
export function openReport(report: Report, saved: boolean, { fresh = true, replace = false } = {}) {
  current = { report, saved };
  if (fresh) addToHistory(report, saved).catch(() => {});
  if (replace) router.replace('/report');
  else router.push('/report');
}
