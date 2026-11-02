/**
 * POST /api/portal-ministro/auth/reset-password
 * Recebe o token de recuperação / ativação, valida expiração,
 * garante atomicidade entre a gravação da senha e o consumo do token (com rollback compensatório em caso de falha),
 * impede sobrescrita indevida de contas existentes e previne qualquer ativação parcial.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';
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
      return NextResponse.json({ error: 'Token de ativação/recuperação não fornecido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = await consumeDistributedRateLimit({
      key: `portal-ministro:reset-password:${ip}`,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas ou serviço temporariamente restrito para sua segurança. Aguarde um momento antes de tentar novamente.' },
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

    // 1. Busca e valida o token ativo
    const { data: resetRecord, error: resetErr } = await supabase
      .from('ministro_portal_password_resets')
      .select('id, ministro_id, expires_at, used')
      .eq('token', token)
      .maybeSingle();

    if (resetErr || !resetRecord) {
      return NextResponse.json(
        { error: 'Link de confirmação inválido ou inexistente. Solicite um novo link.' },
        { status: 404 },
      );
    }

    if (resetRecord.used) {
      return NextResponse.json(
        { error: 'Este link já foi utilizado. Solicite um novo link se necessário.' },
        { status: 410 },
      );
    }

    if (new Date(resetRecord.expires_at) <= new Date(agora)) {
      return NextResponse.json(
        { error: 'Este link expirou (validade: 15 minutos). Solicite uma nova confirmação.' },
        { status: 410 },
      );
    }

    // 2. Reserva atômica do Token (Marca used = true condicional a used = false)
    const { data: reservedRecord, error: reserveErr } = await supabase
      .from('ministro_portal_password_resets')
      .update({
        used: true,
        used_at: agora,
      })
      .eq('id', resetRecord.id)
      .eq('used', false)
      .select('id')
      .maybeSingle();

    if (reserveErr || !reservedRecord) {
      return NextResponse.json(
        { error: 'Este link já foi utilizado ou está sendo processado por outra requisição simultânea.' },
        { status: 410 },
      );
    }

    // 3. Verifica existência prévia de conta para resguardar atomicidade e histórico
    const { data: existingAccount } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id, senha_hash, created_at')
      .eq('ministro_id', resetRecord.ministro_id)
      .maybeSingle();

    // 4. Gera hash bcrypt da nova senha
    const senhaHash = await bcrypt.hash(senha, 10);

    // 5. Gravação da Senha (UPSERT com integridade referencial ao ministro_id do token)
    const { error: accErr } = await supabase
      .from('ministro_portal_accounts')
      .upsert({
        ministro_id: resetRecord.ministro_id,
        senha_hash: senhaHash,
        updated_at: agora,
      }, { onConflict: 'ministro_id' });

    // Se a gravação da conta falhar, executa ROLLBACK COMPENSATÓRIO:
    // Reabre o token para que o ministro não perca a tentativa nem fique com ativação parcial
    if (accErr) {
      console.error('[reset-password] Falha ao persistir senha. Executando rollback compensatório do token:', accErr.message);

      await supabase
        .from('ministro_portal_password_resets')
        .update({
          used: false,
          used_at: null,
        })
        .eq('id', resetRecord.id);

      return NextResponse.json(
        { error: 'Ocorreu uma instabilidade ao salvar sua nova senha. Seu link permanece seguro; por favor, tente novamente.' },
        { status: 500 },
      );
    }

    // 6. Registra log de auditoria oficial
    void logDB({
      acao: existingAccount ? 'redefinicao_senha' : 'primeiro_acesso_concluido',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: resetRecord.ministro_id,
      descricao: existingAccount
        ? `Senha redefinida com sucesso via link de e-mail`
        : `Primeiro acesso concluído e senha criada com sucesso via link de ativação`,
      status: 'sucesso',
    });

    return NextResponse.json({
      ok: true,
      message: 'Sua senha foi cadastrada com sucesso! Você já pode realizar o login no aplicativo.',
    });
  } catch (err) {
    console.error('[reset-password] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao processar senha.' }, { status: 500 });
  }
}
