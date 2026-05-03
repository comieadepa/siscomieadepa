import { NextResponse } from 'next/server';
import { getOAuth2ClientForSetup } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google/drive/setup
 * Redireciona para a tela de autorização Google.
 * Acesse só uma vez para obter o refresh_token.
 * Proteja com variável de ambiente GOOGLE_SETUP_SECRET:
 *   /api/auth/google/drive/setup?secret=SUA_CHAVE_SECRETA
 */
export async function GET(request: Request) {
  const secret = process.env.GOOGLE_SETUP_SECRET;
  if (secret) {
    const url = new URL(request.url);
    if (url.searchParams.get('secret') !== secret) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }
  }

  try {
    const oauth2 = getOAuth2ClientForSetup();
    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',           // força emissão de refresh_token
      scope: ['https://www.googleapis.com/auth/drive'],
    });

    return NextResponse.redirect(authUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
