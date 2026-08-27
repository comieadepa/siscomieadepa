/**
 * POST /api/portal-ministro/auth/first-access/validate-birthdate
 * Valida a data de nascimento do ministro no 1º acesso antes de liberar os campos de senha e e-mail.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';

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
    const cpf = cleanCpf(String(body?.cpf || ''));
    const dataNascimento = String(body?.data_nascimento || '').trim();

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    if (!dataNascimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return NextResponse.json({ error: 'Data de nascimento inválida.' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const rate = checkRateLimit({
      key: `portal-ministro:fa-val-date:${ip}:${cpf}`,
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

    // Busca ministro
    const { data: ministro, error: mErr } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, email, custom_fields')
      .eq('cpf', cpf)
      .maybeSingle();

    if (mErr || !ministro) {
      return NextResponse.json({ error: 'Cadastro ministerial não encontrado.' }, { status: 404 });
    }

    if (ministro.status !== 'active') {
      return NextResponse.json({ error: 'Acesso não disponível. Procure a Secretaria.' }, { status: 403 });
    }

    // Verifica se já tem conta criada
    const { data: existingAccount } = await supabase
      .from('ministro_portal_accounts')
      .select('ministro_id')
      .eq('ministro_id', ministro.id)
      .maybeSingle();

    if (existingAccount) {
      return NextResponse.json(
        { error: 'Conta já cadastrada. Por favor, utilize seu login e senha.' },
        { status: 409 },
      );
    }

    // Valida data de nascimento
    const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
      ? (ministro.custom_fields as Record<string, any>)
      : {};

    const rawBirthDate = ministro.data_nascimento || cf.dataNascimento || cf.data_nascimento || '';
    const dbDate = String(rawBirthDate).trim().slice(0, 10);

    if (dbDate !== dataNascimento) {
      return NextResponse.json({ error: 'Data de nascimento incorreta.' }, { status: 401 });
    }

    // Sugere e-mail se já existir no cadastro, para maior comodidade
    const emailExistente = String(ministro.email || cf.email || '').trim();

    return NextResponse.json({
      ok: true,
      emailSugerido: emailExistente && emailExistente.includes('@') ? emailExistente : '',
      message: 'Identidade confirmada com sucesso.',
    });
  } catch (err) {
    console.error('[validate-birthdate] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno no servidor.' }, { status: 500 });
  }
}
