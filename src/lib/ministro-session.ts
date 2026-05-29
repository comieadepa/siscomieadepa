/**
 * Utilitário de sessão para o Portal do Ministro.
 * Valida o token ministro_token do cookie e retorna o ministro_id.
 */

import { createServerClient } from '@/lib/supabase-server';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const MINISTRO_COOKIE = 'ministro_token';
export const SESSION_DURATION_HOURS = 24;

export interface MinistroSession {
  ministroId: string;
  token: string;
}

/**
 * Lê e valida a sessão do ministro a partir do cookie da request.
 * Retorna null se não houver sessão válida.
 */
export async function getMinistroSession(
  request: NextRequest,
): Promise<MinistroSession | null> {
  const token =
    request.cookies.get(MINISTRO_COOKIE)?.value ||
    request.headers.get('x-ministro-token') ||
    null;

  if (!token) return null;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('ministro_portal_sessions')
    .select('ministro_id, token, expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return { ministroId: data.ministro_id as string, token: data.token as string };
}

/**
 * Lê e valida a sessão do ministro a partir dos cookies do servidor (sem request).
 */
export async function getMinistroSessionFromCookies(): Promise<MinistroSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MINISTRO_COOKIE)?.value;
  if (!token) return null;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('ministro_portal_sessions')
    .select('ministro_id, token, expires_at')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return { ministroId: data.ministro_id as string, token: data.token as string };
}

/**
 * Resposta padrão de não autorizado para o portal do ministro.
 */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Sessão inválida ou expirada. Faça login novamente.' },
    { status: 401 },
  );
}

/**
 * Define o cookie de sessão no response.
 */
export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(MINISTRO_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_HOURS * 3600,
  });
  return response;
}

/**
 * Remove o cookie de sessão no response.
 */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(MINISTRO_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
