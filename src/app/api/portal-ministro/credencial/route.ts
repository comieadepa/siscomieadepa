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
    .select('id, unique_id, cred_validade, created_at, status, custom_fields')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (error || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  const cf = (ministro.custom_fields && typeof ministro.custom_fields === 'object')
    ? (ministro.custom_fields as Record<string, any>)
    : {};

  const validadeStr = (ministro.cred_validade || cf.dataValidadeCredencial || cf.validade || null) as string | null;
  const dataEmissaoStr = (cf.dataEmissao || ministro.created_at || null) as string | null;

  const hoje = new Date();
  const validade = validadeStr ? new Date(validadeStr) : null;

  let statusCredencial: 'ativa' | 'vencida' | 'pendente' = 'pendente';
  if (validade) {
    statusCredencial = validade >= hoje && ministro.status === 'active' ? 'ativa' : 'vencida';
  }

  const credencialUrl = ministro.unique_id
    ? `${process.env.NEXT_PUBLIC_APP_URL || ''}/autentica_qrcode-05985642/${ministro.unique_id}`
    : null;

  return NextResponse.json({
    statusCredencial,
    dataValidade: validadeStr,
    dataEmissao: dataEmissaoStr,
    uniqueId: ministro.unique_id,
    credencialUrl,
  });
}
