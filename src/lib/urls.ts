import type { NextRequest } from 'next/server';

type RequestLike = NextRequest | Request | undefined;

function getOriginFromRequest(request?: RequestLike): string {
  if (!request) return '';
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeValidBase(url?: string | null): string {
  const raw = (url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return normalizeBase(raw);
  } catch {
    return '';
  }
}

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';
export const PUBLIC_URL = process.env.NEXT_PUBLIC_PUBLIC_URL ?? '';

export function getBaseUrl(options?: {
  request?: RequestLike;
  prefer?: 'app' | 'public';
  allowWindow?: boolean;
}): string {
  const preferApp = options?.prefer === 'app' ? normalizeValidBase(APP_URL) : '';
  const preferPublic = options?.prefer === 'public' ? normalizeValidBase(PUBLIC_URL) : '';
  const fromReq = normalizeValidBase(getOriginFromRequest(options?.request));
  const fromApp = normalizeValidBase(APP_URL);
  const fromPublic = normalizeValidBase(PUBLIC_URL);
  const fromWindow = options?.allowWindow && typeof window !== 'undefined'
    ? normalizeValidBase(window.location.origin)
    : '';

  return preferApp || preferPublic || fromReq || fromApp || fromPublic || fromWindow || '';
}

export function getAppBaseUrl(options?: { request?: RequestLike }): string {
  return getBaseUrl({ request: options?.request, prefer: 'app', allowWindow: typeof window !== 'undefined' });
}

export function getPublicBaseUrl(options?: { request?: RequestLike }): string {
  return getBaseUrl({ request: options?.request, prefer: 'public', allowWindow: typeof window !== 'undefined' });
}

export function buildUrl(base: string, path: string): string {
  const cleanBase = normalizeValidBase(base);
  if (!cleanBase) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
