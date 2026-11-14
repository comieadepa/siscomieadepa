/**
 * POST /api/portal-ministro/auth/login
 * Autenticação habitual exclusiva por E-mail e Senha (bcrypt.compare).
 * Não solicita nem exige CPF ou matrícula no login regular.
 * Impede login de contas com e-mail ainda pendente de confirmação.
 * Suporta fallback transparente para contas migradas/existentes.
 * Cria sessão de 24h (ou estendida) e emite cookie ministro_token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { setSessionCookie, SESSION_DURATION_HOURS } from '@/lib/ministro-session';
import { logDB } from '@/lib/audit';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';
import bcrypt from 'bcrypt';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

async function criarSessao(supabase: ReturnType<typeof createServerClient>, ministroId: string) {
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();
  const { data: session, error } = await supabase
    .from('ministro_portal_sessions')
    .insert({ ministro_id: ministroId, expires_at: expiresAt })
    .select('token')
    .single();
  if (error || !session) return null;
  return session.token as string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawEmail = String(body?.email || body?.identificador || '').trim().toLowerCase();
    const senha = String(body?.senha || body?.password || '');

    if (!rawEmail || !rawEmail.includes('@')) {
      return NextResponse.json({ error: 'Informe um endereço de e-mail válido.' }, { status: 400 });
    }

    if (!senha) {
      return NextResponse.json({ error: 'Informe sua senha de acesso.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rateKey = `portal-ministro:login-email:${ip}:${rawEmail}`;

    const rate = await consumeDistributedRateLimit({
      key: rateKey,
      limit: RATE_LIMIT_ATTEMPTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Muitas tentativas de login. Aguarde um minuto antes de tentar novamente.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rate.retryAfterSeconds) },
        },
      );
    }

    const supabase = createServerClient();

    // 1. Busca conta no portal por e-mail registrado na conta ou na tabela members
    // Prioriza busca em ministro_portal_accounts
    const { data: accountByEmail } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id, senha_hash, email, email_confirmed')
      .ilike('email', rawEmail)
      .maybeSingle();

    let account = accountByEmail;
    let ministroId = account?.ministro_id;

    // Se não encontrou pelo campo email de accounts (ex: conta legada criada antes da migration),
    // busca pelo e-mail oficial em members
    if (!account) {
      const { data: member } = await supabase
        .from('members')
        .select('id, name, status, email')
        .ilike('email', rawEmail)
        .eq('status', 'active')
        .maybeSingle();

      if (member) {
        ministroId = member.id;
        const { data: acc } = await supabase
          .from('ministro_portal_accounts')
          .select('ministro_id, senha_hash, email, email_confirmed')
          .eq('ministro_id', member.id)
          .maybeSingle();

        if (acc) {
          account = acc;
        }
      }
    }

    if (!account || !ministroId) {
      // Prevenção de enumeração com mensagem amigável e segura
      return NextResponse.json(
        { error: 'E-mail ou senha incorretos. Se ainda não possui acesso, faça o Primeiro Acesso.' },
        { status: 401 },
      );
    }

    // 2. Valida se a conta está com confirmação de e-mail pendente
    if (account.email_confirmed === false) {
      return NextResponse.json(
        {
          error: 'Seu cadastro ainda está pendente de confirmação. Por favor, acesse o link enviado para o seu e-mail para ativar sua conta.',
          pendenteConfirmacao: true,
        },
        { status: 403 },
      );
    }

    // 3. Valida a situação do ministro na convenção
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, status')
      .eq('id', ministroId)
      .maybeSingle();

    if (mErr || !ministro || ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu cadastro ministerial não está ativo. Procure a Secretaria Geral.' },
        { status: 403 },
      );
    }

    // 4. Validação da senha com bcrypt
    const match = await bcrypt.compare(senha, account.senha_hash);
    if (!match) {
      return NextResponse.json(
        { error: 'E-mail ou senha incorretos.' },
        { status: 401 },
      );
    }

    // 5. Cria sessão segura e define cookie
    const token = await criarSessao(supabase, ministro.id);
    if (!token) {
      return NextResponse.json({ error: 'Erro ao gerar sessão de acesso.' }, { status: 500 });
    }

    void logDB({
      acao: 'login_email_sucesso',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Login efetuado com sucesso por e-mail: ${ministro.name}`,
      status: 'sucesso',
    });

    const res = NextResponse.json({ ok: true, nome: ministro.name });
    return setSessionCookie(res, token);
  } catch (err) {
    console.error('[portal-ministro/login] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao autenticar.' }, { status: 500 });
  }
}
