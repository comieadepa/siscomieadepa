/**
 * GET /api/portal-ministro/credencial
 * Retorna status da credencial do ministro autenticado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();
  const { data: ministro, error } = await supabase
    .from('members')
    .select('id, unique_id, data_validade_credencial, data_emissao, status')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (error || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  const hoje = new Date();
  const validade = ministro.data_validade_credencial
    ? new Date(ministro.data_validade_credencial)
    : null;

  let statusCredencial: 'ativa' | 'vencida' | 'pendente' = 'pendente';
  if (validade) {
    statusCredencial = validade >= hoje ? 'ativa' : 'vencida';
  }

  const credencialUrl = ministro.unique_id
    ? `${process.env.NEXT_PUBLIC_APP_URL || ''}/credencial/${ministro.unique_id}`
    : null;

  return NextResponse.json({
    statusCredencial,
    dataValidade: ministro.data_validade_credencial,
    dataEmissao: ministro.data_emissao,
    uniqueId: ministro.unique_id,
    credencialUrl,
  });
}
