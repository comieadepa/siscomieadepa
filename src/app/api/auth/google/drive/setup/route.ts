import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2ClientForSetup } from '@/lib/google-drive';
import { requireRole } from '@/lib/auth/require-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google/drive/setup
 * Redireciona para a tela de autorização Google.
 * Acesse só uma vez para obter o refresh_token.
 * Proteja com variável de ambiente GOOGLE_SETUP_SECRET via header:
 *   x-google-setup-secret: SUA_CHAVE_SECRETA
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ['super', 'administrador']);
  if (!auth.ok) return auth.response;

  const secret = process.env.GOOGLE_SETUP_SECRET;
  if (secret) {
    const provided = request.headers.get('x-google-setup-secret') || request.nextUrl.searchParams.get('secret') || '';
    if (provided !== secret) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }
  }

  try {
    const oauth2 = getOAuth2ClientForSetup();
    const state = randomUUID();
    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      state,
      scope: ['https://www.googleapis.com/auth/drive'],
    });

    const response = NextResponse.redirect(authUrl);
    response.cookies.set('google_drive_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/auth/google/drive',
      maxAge: 600,
    });

    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
