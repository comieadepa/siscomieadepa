import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';

const ESTRUTURA_ROLES = ['super', 'administrador', 'comissao', 'inscricao', 'financeiro', 'cgadb'] as const;

async function getAllRows(
  supabase: any,
  table: string,
  select: string,
  isActiveOnly: boolean
) {
  let allData: any[] = [];
  let from = 0;
  const limit = 1000;
  let hasMore = true;
  while (hasMore) {
    let query = supabase.from(table).select(select).order('nome').range(from, from + limit - 1);
    if (isActiveOnly) {
      query = query.neq('is_active', false);
    }
    const { data, error } = await query;
    if (error) throw error;
    allData = [...allData, ...(data || [])];
    hasMore = data && data.length === limit;
    from += limit;
  }
  return allData;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ESTRUTURA_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const supabase = createServerClient();

  try {
    const [supervisoes, campos, congregacoes] = await Promise.all([
      getAllRows(supabase, 'supervisoes', 'id,nome,is_active', !includeInactive),
      getAllRows(supabase, 'campos', 'id,nome,supervisao_id,is_active,pastor_member_id,presidente_nome,presidente_cpf,presidente_matricula,telefone', !includeInactive),
      getAllRows(supabase, 'congregacoes', 'id,nome,supervisao_id,campo_id,is_active', !includeInactive),
    ]);

    return NextResponse.json({
      supervisoes,
      campos,
      congregacoes,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar estrutura.' }, { status: 500 });
  }
}
