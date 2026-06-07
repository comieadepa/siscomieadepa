import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

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
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const supabase = createServerClient();

  try {
    const [supervisoes, campos, congregacoes] = await Promise.all([
      getAllRows(supabase, 'supervisoes', '*', !includeInactive),
      getAllRows(supabase, 'campos', '*', !includeInactive),
      getAllRows(supabase, 'congregacoes', '*', !includeInactive),
    ]);

    return NextResponse.json({
      supervisoes,
      campos,
      congregacoes,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Erro ao carregar estrutura da secretaria.' }, { status: 500 });
  }
}
