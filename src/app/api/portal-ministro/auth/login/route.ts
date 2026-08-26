/**
 * POST /api/portal-ministro/auth/login
 * Autenticação exclusiva de ministro com senha (bcrypt.compare).
 * Cria sessão de 24h e emite cookie ministro_token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { setSessionCookie, SESSION_DURATION_HOURS } from '@/lib/ministro-session';
import { logDB } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import bcrypt from 'bcrypt';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const cleanCpf = (v: string) => v.replace(/\D/g, '');

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
    const tipo: string = String(body?.tipo || 'senha');
    const cpf = cleanCpf(String(body?.cpf || ''));

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:login:${ip}:${cpf}`,
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

    const supabase = createServerClient();

    const { data: ministro, error: memberError } = await supabase
      .from('members')
      .select('id, name, cpf, status, cargo_ministerial, pastor_presidente')
      .eq('cpf', cpf)
      .in('status', ['active'])
      .maybeSingle();

    if (memberError) {
      console.error('[portal-ministro/login]', memberError.message);
      return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
    }

    if (!ministro) {
      return NextResponse.json({ error: 'CPF não encontrado no cadastro ministerial.' }, { status: 401 });
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria.' },
        { status: 403 },
      );
    }

    // Rejeita qualquer tentativa de primeiro acesso nesta rota (deve usar /first-access/*)
    if (tipo === 'primeiro_acesso') {
      return NextResponse.json(
        { error: 'O primeiro acesso deve ser realizado exclusivamente com código de confirmação.' },
        { status: 400 },
      );
    }

    if (tipo !== 'senha') {
      return NextResponse.json({ error: 'Tipo de autenticação inválido.' }, { status: 400 });
    }

    // ── Login com senha ───────────────────────────────────────────────────
    const senha = String(body?.senha || '');
    if (!senha) {
      return NextResponse.json({ error: 'Senha obrigatória.' }, { status: 400 });
    }

    const { data: account } = await supabase
      .from('ministro_portal_accounts')
      .select('senha_hash')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (!account) {
      return NextResponse.json(
        { error: 'Nenhuma senha cadastrada. Faça o primeiro acesso.' },
        { status: 401 },
      );
    }

    const match = await bcrypt.compare(senha, account.senha_hash);
    if (!match) {
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
    }

    const token = await criarSessao(supabase, ministro.id);
    if (!token) return NextResponse.json({ error: 'Erro ao criar sessão.' }, { status: 500 });

    void logDB({
      acao: 'login',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Login no portal do ministro: ${ministro.name}`,
      status: 'sucesso',
    });

    const res = NextResponse.json({ ok: true, nome: ministro.name });
    return setSessionCookie(res, token);
  } catch (err: unknown) {
    console.error('[portal-ministro/login] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
