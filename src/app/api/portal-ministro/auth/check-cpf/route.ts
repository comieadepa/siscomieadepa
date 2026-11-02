/**
 * POST /api/portal-ministro/auth/check-cpf
 * Verifica se o identificador (CPF ou E-mail) existe, se o membro está ativo
 * e se já tem senha cadastrada.
 * Retorna { exists: boolean, hasPassword: boolean, nome: string, identificadorTipo: 'cpf' | 'email', cpf?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { consumeDistributedRateLimit } from '@/lib/rate-limit-distributed';

const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

const cleanCpf = (v: string) => v.replace(/\D/g, '');

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawIdentificador = String(body?.identificador || body?.cpf || body?.email || '').trim();
    const cleanIdentificador = cleanCpf(rawIdentificador);
    const isEmail = rawIdentificador.includes('@');

    if (!rawIdentificador) {
      return NextResponse.json({ error: 'Informe seu CPF ou E-mail.' }, { status: 400 });
    }

    if (!isEmail && cleanIdentificador.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rateKey = isEmail
      ? `portal-ministro:check-cpf:${ip}:${rawIdentificador.toLowerCase()}`
      : `portal-ministro:check-cpf:${ip}:${cleanIdentificador}`;

    const rate = await consumeDistributedRateLimit({
      key: rateKey,
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

    let query = supabase
      .from('members')
      .select('id, name, cpf, email, status');

    if (isEmail) {
      query = query.ilike('email', rawIdentificador.toLowerCase());
    } else {
      query = query.eq('cpf', cleanIdentificador);
    }

    const { data: ministros, error: mErr } = await query;

    if (mErr) {
      console.error('[check-cpf]', mErr.message);
      return NextResponse.json({ error: 'Erro interno ao consultar cadastro.' }, { status: 500 });
    }

    if (!ministros || ministros.length === 0) {
      return NextResponse.json(
        { error: isEmail ? 'E-mail não encontrado no cadastro ministerial.' : 'CPF não encontrado no cadastro ministerial.' },
        { status: 404 },
      );
    }

    if (ministros.length > 1) {
      return NextResponse.json(
        { error: 'Mais de um cadastro localizado para este e-mail. Por favor, identifique-se informando seu CPF.' },
        { status: 409 },
      );
    }

    const ministro = ministros[0];

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria Geral.' },
        { status: 403 },
      );
    }

    const { data: account } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    return NextResponse.json({
      exists: true,
      hasPassword: !!account,
      nome: ministro.name as string,
      identificadorTipo: isEmail ? 'email' : 'cpf',
      cpf: ministro.cpf as string,
    });
  } catch (err) {
    console.error('[check-cpf]', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
