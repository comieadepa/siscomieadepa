/**
 * POST /api/portal-ministro/auth/reset-password
 * Recebe o token de recuperação, valida e define a nova senha com hash bcrypt.
 * Invalida o token após a alteração.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logDB } from '@/lib/audit';
import bcrypt from 'bcrypt';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body?.token || '').trim();
    const senha = String(body?.senha || '');
    const senhaConfirm = String(body?.senhaConfirm || '');

    if (!token) {
      return NextResponse.json({ error: 'Token de recuperação não fornecido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:reset-password:${ip}`,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfterSeconds),
          },
        },
      );
    }

    // Validações de força de senha
    const hasMinLen = senha.length >= 6;
    const hasLetter = /[a-zA-Z]/.test(senha);
    const hasNumber = /[0-9]/.test(senha);

    if (!hasMinLen || !hasLetter || !hasNumber) {
      return NextResponse.json(
        { error: 'A senha deve ter no mínimo 6 caracteres, contendo pelo menos 1 letra e 1 número.' },
        { status: 400 },
      );
    }

    if (senha !== senhaConfirm) {
      return NextResponse.json({ error: 'As senhas digitadas não coincidem.' }, { status: 400 });
    }

    const supabase = createServerClient();
    const agora = new Date().toISOString();

    // Busca o token de recuperação ativo
    const { data: resetRecord, error: resetErr } = await supabase
      .from('ministro_portal_password_resets')
      .select('id, ministro_id, expires_at, used')
      .eq('token', token)
      .maybeSingle();

    if (resetErr || !resetRecord) {
      return NextResponse.json(
        { error: 'Link de recuperação inválido ou inexistente. Solicite uma nova recuperação.' },
        { status: 404 },
      );
    }

    if (resetRecord.used) {
      return NextResponse.json(
        { error: 'Este link de recuperação já foi utilizado. Solicite um novo link se necessário.' },
        { status: 410 },
      );
    }

    if (new Date(resetRecord.expires_at) <= new Date(agora)) {
      return NextResponse.json(
        { error: 'Este link de recuperação expirou (validade: 15 minutos). Solicite uma nova recuperação.' },
        { status: 410 },
      );
    }

    // Gera o novo hash da senha
    const senhaHash = await bcrypt.hash(senha, 10);

    // Atualiza ou insere a conta com a nova senha
    const { error: accErr } = await supabase
      .from('ministro_portal_accounts')
      .upsert({
        ministro_id: resetRecord.ministro_id,
        senha_hash: senhaHash,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'ministro_id' });

    if (accErr) {
      console.error('[reset-password] Erro ao atualizar senha:', accErr.message);
      return NextResponse.json({ error: 'Erro ao salvar nova senha. Tente novamente.' }, { status: 500 });
    }

    // Invalida o token imediatamente (uso único)
    await supabase
      .from('ministro_portal_password_resets')
      .update({
        used: true,
        used_at: new Date().toISOString(),
      })
      .eq('id', resetRecord.id);

    // Registra log de auditoria
    void logDB({
      acao: 'redefinicao_senha',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: resetRecord.ministro_id,
      descricao: `Senha redefinida via link de recuperação por e-mail`,
      status: 'sucesso',
    });

    return NextResponse.json({
      ok: true,
      message: 'Sua senha foi redefinida com sucesso! Você já pode realizar o login.',
    });
  } catch (err) {
    console.error('[reset-password] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao redefinir senha.' }, { status: 500 });
  }
}
