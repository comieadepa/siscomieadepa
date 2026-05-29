/**
 * POST /api/portal-ministro/auth/logout
 * Invalida a sessão do ministro e remove o cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, clearSessionCookie } from '@/lib/ministro-session';

export async function POST(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (session) {
    const supabase = createServerClient();
    await supabase
      .from('ministro_portal_sessions')
      .delete()
      .eq('token', session.token);
  }
  const res = NextResponse.json({ ok: true });
  return clearSessionCookie(res);
}
