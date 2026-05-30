/**
 * POST /api/portal-ministro/auth/check-cpf
 * Verifica se o CPF existe, se o membro está ativo e se já tem senha cadastrada.
 * Retorna { exists: boolean, hasPassword: boolean, nome: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

const cleanCpf = (v: string) => v.replace(/\D/g, '');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cpf = cleanCpf(String(body?.cpf || ''));

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Busca o membro pelo CPF (sem filtro de status para dar mensagem correta)
    const { data: ministro } = await supabase
      .from('members')
      .select('id, name, status')
      .eq('cpf', cpf)
      .maybeSingle();

    if (!ministro) {
      return NextResponse.json(
        { error: 'CPF não encontrado no cadastro ministerial.' },
        { status: 404 },
      );
    }

    if (ministro.status !== 'active') {
      return NextResponse.json(
        { error: 'Seu acesso não está disponível. Procure a Secretaria.' },
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
    });
  } catch (err) {
    console.error('[check-cpf]', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
