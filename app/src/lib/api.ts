import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

import type { Report } from './types';

// In development the server runs on the same computer as the Expo dev server.
// Expo Go reports that computer's address (e.g. "192.168.1.12:8081"), so we reuse its host.
// Development builds (npx expo run:ios) don't report it, so we fall back to the address
// the JS bundle was loaded from. For a deployed server, set EXPO_PUBLIC_API_URL.
function devHost(): string | undefined {
  const fromExpo = Constants.expoConfig?.hostUri?.split(':')[0];
  if (fromExpo) return fromExpo;
  const sourceCode = NativeModules.SourceCode;
  const scriptURL: string | undefined = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
  return scriptURL?.match(/^https?:\/\/([^:/]+)/)?.[1];
}

function baseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  return `http://${devHost() ?? 'localhost'}:4400`;
}
export const API_URL = baseUrl();

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_URL}. Make sure it's running and your phone is on the same Wi-Fi.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? 'Something went wrong.');
  return data as T;
}

export type Health = { ok: boolean; mode: 'claude' | 'sample'; model: string | null; products: number };
export const getHealth = () => call<Health>('/api/health');

export type LookupResult = { found: false; gtin: string } | { found: true; gtin: string; report: Report };
export const lookupBarcode = (code: string) => call<LookupResult>(`/api/products/${encodeURIComponent(code)}`);

export type ReadResult = { gtin: string | null; saved: boolean; report: Report };

export const readImage = (kind: 'label' | 'screenshot', imageBase64: string, gtin?: string) =>
  call<ReadResult>('/api/label', { method: 'POST', body: JSON.stringify({ kind, imageBase64, mediaType: 'image/jpeg', gtin }) });

export const readListing = (url: string) => call<ReadResult>('/api/listing', { method: 'POST', body: JSON.stringify({ url }) });

export const methodologyUrl = `${API_URL}/methodology`;
export const correctionsUrl = `${API_URL}/corrections`;
