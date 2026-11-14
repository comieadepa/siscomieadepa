/**
 * POST /api/portal-ministro/auth/confirm-email
 * Valida o token recebido no e-mail,
 * ativa a conta (email_confirmed = true),
 * invalida o token para impedir reutilização,
 * e atualiza o e-mail oficial em public.members se ainda não estiver preenchido.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';
import { logDB } from '@/lib/audit';

const RATE_LIMIT_ATTEMPTS = 10;
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

    if (!token) {
      return NextResponse.json({ error: 'Token de confirmação não fornecido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = await consumeDistributedRateLimit({
      key: `portal-ministro:confirm-email:${ip}`,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde um minuto.' },
        { status: 429 },
      );
    }

    const supabase = createServerClient();
    const agora = new Date().toISOString();

    // 1. Busca conta pendente com o token
    const { data: account, error: accErr } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id, email, email_confirmed, confirmation_token, confirmation_expires_at')
      .eq('confirmation_token', token)
      .maybeSingle();

    if (accErr || !account) {
      return NextResponse.json(
        { error: 'Link de confirmação inválido, inexistente ou já utilizado anteriormente.' },
        { status: 404 },
      );
    }

    if (account.email_confirmed) {
      return NextResponse.json(
        { error: 'Este e-mail já foi confirmado anteriormente. Você já pode fazer login com sua senha.' },
        { status: 410 },
      );
    }

    if (account.confirmation_expires_at && new Date(account.confirmation_expires_at) <= new Date(agora)) {
      return NextResponse.json(
        { error: 'O link de confirmação expirou. Por favor, solicite um novo cadastro no Primeiro Acesso.' },
        { status: 410 },
      );
    }

    // 2. Ativação atômica da conta e invalidação do token
    const { error: updateErr } = await supabase
      .from('ministro_portal_accounts')
      .update({
        email_confirmed: true,
        confirmation_token: null, // impede reutilização
        confirmation_expires_at: null,
        updated_at: agora,
      })
      .eq('ministro_id', account.ministro_id);

    if (updateErr) {
      console.error('[confirm-email] Falha ao ativar conta:', updateErr.message);
      return NextResponse.json({ error: 'Erro ao ativar sua conta. Tente novamente.' }, { status: 500 });
    }

    // 3. Atualiza o e-mail na tabela members se estiver vazio ou divergente
    if (account.email) {
      await supabase
        .from('members')
        .update({ email: account.email })
        .eq('id', account.ministro_id)
        .is('email', null);
    }

    // 4. Registra auditoria
    void logDB({
      acao: 'confirmacao_email_sucesso',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: account.ministro_id,
      descricao: `Conta ativada com sucesso após confirmação do e-mail ${account.email}`,
      status: 'sucesso',
    });

    return NextResponse.json({
      ok: true,
      message: 'E-mail confirmado com sucesso! Sua conta está ativada.',
    });
  } catch (err) {
    console.error('[confirm-email] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao confirmar e-mail.' }, { status: 500 });
  }
}
