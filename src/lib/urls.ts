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

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';
export const PUBLIC_URL = process.env.NEXT_PUBLIC_PUBLIC_URL ?? '';
const IS_PROD = process.env.NODE_ENV === 'production';

export function getAppBaseUrl(options?: { request?: RequestLike }): string {
  if (APP_URL) return normalizeBase(APP_URL);
  const fromReq = getOriginFromRequest(options?.request);
  if (fromReq) return fromReq;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function getPublicBaseUrl(options?: { request?: RequestLike }): string {
  if (PUBLIC_URL) return normalizeBase(PUBLIC_URL);
  if (IS_PROD) {
    throw new Error('NEXT_PUBLIC_PUBLIC_URL não configurado');
  }
  if (APP_URL) return normalizeBase(APP_URL);
  const fromReq = getOriginFromRequest(options?.request);
  if (fromReq) return fromReq;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

export function buildUrl(base: string, path: string): string {
  if (!base) return path;
  const cleanBase = normalizeBase(base);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
