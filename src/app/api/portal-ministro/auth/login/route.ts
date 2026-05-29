/**
 * POST /api/portal-ministro/auth/login
 * Autentica o ministro com CPF + data de nascimento.
 * Gera um token de sessão e define o cookie httpOnly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { setSessionCookie, SESSION_DURATION_HOURS } from '@/lib/ministro-session';
import { logDB } from '@/lib/audit';

// Remove tudo que não for dígito do CPF
const cleanCpf = (v: string) => v.replace(/\D/g, '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cpf = cleanCpf(String(body?.cpf || ''));
    const dataNascimento = String(body?.data_nascimento || '').trim(); // YYYY-MM-DD

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }
    if (!dataNascimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return NextResponse.json(
        { error: 'Data de nascimento inválida (formato: YYYY-MM-DD).' },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Busca ministro ativo pelo CPF
    const { data: ministro, error: memberError } = await supabase
      .from('members')
      .select('id, name, cpf, data_nascimento, status, cargo_ministerial, pastor_presidente')
      .eq('cpf', cpf)
      .in('status', ['active'])
      .maybeSingle();

    if (memberError) {
      console.error('[portal-ministro/login] Erro ao buscar membro:', memberError.message);
      return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
    }

    // Não revelar se o CPF existe ou não (evita enumeração)
    if (!ministro || !ministro.data_nascimento) {
      return NextResponse.json(
        { error: 'CPF ou data de nascimento incorretos.' },
        { status: 401 },
      );
    }

    // Compara data_nascimento (aceita YYYY-MM-DD e outros formatos ISO)
    const dbDate = String(ministro.data_nascimento).slice(0, 10);
    if (dbDate !== dataNascimento) {
      return NextResponse.json(
        { error: 'CPF ou data de nascimento incorretos.' },
        { status: 401 },
      );
    }

    // Cria sessão
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();
    const { data: session, error: sessionError } = await supabase
      .from('ministro_portal_sessions')
      .insert({ ministro_id: ministro.id, expires_at: expiresAt })
      .select('token')
      .single();

    if (sessionError || !session) {
      console.error('[portal-ministro/login] Erro ao criar sessão:', sessionError?.message);
      return NextResponse.json({ error: 'Erro ao criar sessão.' }, { status: 500 });
    }

    void logDB({
      acao: 'login',
      modulo: 'portal_ministro',
      entidade: 'ministro',
      entidadeId: ministro.id,
      descricao: `Login no portal do ministro: ${ministro.name}`,
      status: 'sucesso',
    });

    const res = NextResponse.json({ ok: true, nome: ministro.name });
    return setSessionCookie(res, session.token as string);
  } catch (err: any) {
    console.error('[portal-ministro/login] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
