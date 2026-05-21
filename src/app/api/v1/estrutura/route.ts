import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const ESTRUTURA_ROLES = ['super', 'administrador', 'comissao', 'inscricao', 'financeiro', 'cgadb'] as const;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ESTRUTURA_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const supabase = createServerClient();

  let supervisoesQuery = supabase
    .from('supervisoes')
    .select('id,nome,is_active')
    .order('nome');

  let camposQuery = supabase
    .from('campos')
    .select('id,nome,supervisao_id,is_active,pastor_member_id,presidente_nome,presidente_cpf,presidente_matricula,telefone')
    .order('nome')
    .limit(10000);

  let congregacoesQuery = supabase
    .from('congregacoes')
    .select('id,nome,supervisao_id,campo_id,is_active')
    .order('nome')
    .limit(10000);

  if (!includeInactive) {
    supervisoesQuery = supervisoesQuery.neq('is_active', false);
    // neq exclui NULLs em SQL; usar or() para incluir linhas sem is_active definido
    camposQuery = camposQuery.or('is_active.eq.true,is_active.is.null');
    congregacoesQuery = congregacoesQuery.or('is_active.eq.true,is_active.is.null');
  }

  const [supRes, camRes, congRes] = await Promise.all([
    supervisoesQuery,
    camposQuery,
    congregacoesQuery,
  ]);

  if (supRes.error) {
    return NextResponse.json({ error: supRes.error.message }, { status: 500 });
  }

  if (camRes.error) {
    return NextResponse.json({ error: camRes.error.message }, { status: 500 });
  }

  if (congRes.error) {
    return NextResponse.json({ error: congRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    supervisoes: supRes.data ?? [],
    campos: camRes.data ?? [],
    congregacoes: congRes.data ?? [],
  });
}
