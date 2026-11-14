/**
 * POST /api/portal-ministro/auth/first-access/validate-cpf-birthdate
 * Etapa 1 do Primeiro Acesso:
 * Solicita CPF e Data de Nascimento.
 * Valida elegibilidade no cadastro oficial (public.members),
 * impede assunção de contas já ativas e retorna nome e se é elegível.
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

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  // Se vier no formato DD/MM/AAAA ou DD-MM-AAAA
  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(trimmed)) {
    const parts = trimmed.split(/[/-]/);
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  // Se vier no formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawCpf = String(body?.cpf || '').trim();
    const rawBirthDate = String(body?.dataNascimento || body?.birthDate || '').trim();
    const cleanCpfValue = cleanCpf(rawCpf);

    if (!cleanCpfValue || cleanCpfValue.length !== 11) {
      return NextResponse.json({ error: 'Informe um CPF válido com 11 dígitos.' }, { status: 400 });
    }

    if (!rawBirthDate) {
      return NextResponse.json({ error: 'Informe sua data de nascimento.' }, { status: 400 });
    }

    const normalizedBirthDate = normalizeDate(rawBirthDate);

    const ip = getClientIp(request);
    const rate = await consumeDistributedRateLimit({
      key: `portal-ministro:first-access-val-cpf-birth:${ip}:${cleanCpfValue}`,
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

    // 1. Busca membro ativo
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, email')
      .eq('cpf', cleanCpfValue)
      .maybeSingle();

    if (mErr) {
      console.error('[validate-cpf-birthdate] Erro ao buscar ministro:', mErr.message);
      return NextResponse.json({ error: 'Erro interno ao consultar cadastro.' }, { status: 500 });
    }

    if (!ministro) {
      return NextResponse.json(
        { error: 'Cadastro ministerial não localizado com os dados informados. Procure a Secretaria Geral.' },
        { status: 404 },
      );
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria Geral.' },
        { status: 403 },
      );
    }

    // Validação da data de nascimento
    const dbBirthDate = ministro.data_nascimento ? String(ministro.data_nascimento).slice(0, 10) : '';
    if (!dbBirthDate || dbBirthDate !== normalizedBirthDate) {
      return NextResponse.json(
        { error: 'Dados divergentes do cadastro oficial. Verifique seu CPF e data de nascimento ou procure a Secretaria Geral.' },
        { status: 401 },
      );
    }

    // 2. Verifica se já possui conta ativa/confirmada
    const { data: existingAccount } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id, email_confirmed, email')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (existingAccount && existingAccount.email_confirmed !== false) {
      return NextResponse.json(
        {
          error: 'Este cadastro ministerial já possui conta ativa no aplicativo. Por favor, acesse a tela de login ou solicite recuperação de senha.',
          possuiConta: true,
        },
        { status: 409 },
      );
    }

    // Dados válidos e elegível para primeiro acesso
    return NextResponse.json({
      ok: true,
      ministroId: ministro.id,
      nome: ministro.name,
      emailSugerido: ministro.email || '',
    });
  } catch (err) {
    console.error('[validate-cpf-birthdate] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno ao validar dados.' }, { status: 500 });
  }
}
