import { NextRequest, NextResponse } from 'next/server';
import { getOAuth2ClientForSetup } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/google/drive/callback?code=...
 * Google redireciona aqui após autorização.
 * Exibe o refresh_token para copiar para .env.local.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ Autorização negada</h2>
        <p>Erro: ${error}</p>
      </body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  }

  if (!code) {
    return NextResponse.json({ error: 'code ausente' }, { status: 400 });
  }

  try {
    const oauth2 = getOAuth2ClientForSetup();
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return new NextResponse(
        `<html><body style="font-family:sans-serif;padding:40px">
          <h2 style="color:orange">⚠️ refresh_token não retornado</h2>
          <p>Isso acontece quando a conta já autorizou anteriormente.<br>
          Acesse o <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a>,
          remova o acesso do aplicativo e tente novamente via
          <code>/api/auth/google/drive/setup</code></p>
        </body></html>`,
        { headers: { 'content-type': 'text/html' } },
      );
    }

    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;max-width:700px">
        <h2 style="color:green">✅ Autorização concluída!</h2>
        <p>Copie o <strong>refresh_token</strong> abaixo e adicione ao seu <code>.env.local</code>:</p>
        <pre style="background:#f4f4f4;padding:16px;border-radius:8px;word-break:break-all;font-size:13px">${refreshToken}</pre>
        <p style="margin-top:24px">Adicione no <code>.env.local</code>:</p>
        <pre style="background:#1e1e1e;color:#4ec9b0;padding:16px;border-radius:8px;font-size:13px">GOOGLE_DRIVE_REFRESH_TOKEN=${refreshToken}</pre>
        <p style="color:#888;font-size:13px;margin-top:24px">
          Após adicionar, reinicie o servidor (<code>npm run dev</code>).<br>
          Esta página pode ser fechada.
        </p>
      </body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2 style="color:red">❌ Erro ao trocar código</h2>
        <pre>${msg}</pre>
      </body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  }
}
