import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2ClientForSetup } from '@/lib/google-drive';
import { requireRole } from '@/lib/auth/require-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google/drive/callback?code=...&state=...
 * Google redireciona aqui após autorização.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ['super', 'administrador']);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const expectedState = request.cookies.get('google_drive_oauth_state')?.value || '';

  if (error) {
    const response = new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ Autorização negada</h2>
        <p>Erro: ${error}</p>
      </body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
    response.cookies.delete('google_drive_oauth_state');
    return response;
  }

  if (!state || !expectedState || state !== expectedState) {
    const response = new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ Requisição inválida</h2>
        <p>Falha de validação de segurança (state OAuth).</p>
      </body></html>`,
      { status: 400, headers: { 'content-type': 'text/html' } },
    );
    response.cookies.delete('google_drive_oauth_state');
    return response;
  }

  if (!code) {
    const response = NextResponse.json({ error: 'code ausente' }, { status: 400 });
    response.cookies.delete('google_drive_oauth_state');
    return response;
  }

  try {
    const oauth2 = getOAuth2ClientForSetup();
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      const response = new NextResponse(
        `<html><body style="font-family:sans-serif;padding:40px">
          <h2 style="color:orange">⚠️ refresh_token não retornado</h2>
          <p>Isso acontece quando a conta já autorizou anteriormente.<br>
          Acesse o <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a>,
          remova o acesso do aplicativo e tente novamente.<br>
          O token não é exibido por segurança.</p>
        </body></html>`,
        { headers: { 'content-type': 'text/html' } },
      );
      response.cookies.delete('google_drive_oauth_state');
      return response;
    }

    process.env.GOOGLE_DRIVE_REFRESH_TOKEN = refreshToken;

    const response = new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;max-width:700px">
        <h2 style="color:green">✅ Autorização concluída!</h2>
        <p>Token OAuth atualizado em memória do servidor.</p>
        <p style="margin-top:12px">Por segurança, o token não é exibido nesta tela.</p>
        <p style="color:#888;font-size:13px;margin-top:24px">
          Salve o token em variável de ambiente segura para persistir após reinicialização.<br>
          Esta página pode ser fechada.
        </p>
      </body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
    response.cookies.delete('google_drive_oauth_state');
    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const response = new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ Erro ao trocar código</h2>
        <pre>${msg}</pre>
      </body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
    response.cookies.delete('google_drive_oauth_state');
    return response;
  }
}
