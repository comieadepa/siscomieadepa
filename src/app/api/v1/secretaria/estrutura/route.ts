import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const supabase = createServerClient();

  let supervisoesQuery = supabase
    .from('supervisoes')
    .select('*')
    .order('nome');

  let camposQuery = supabase
    .from('campos')
    .select('*')
    .order('nome');

  let congregacoesQuery = supabase
    .from('congregacoes')
    .select('*')
    .order('nome');

  if (!includeInactive) {
    supervisoesQuery = supervisoesQuery.neq('is_active', false);
    camposQuery = camposQuery.neq('is_active', false);
    congregacoesQuery = congregacoesQuery.neq('is_active', false);
  }

  // Supervisoes e congregacoes: raramente passam de 1000, busca unica
  const [supRes, congRes] = await Promise.all([supervisoesQuery, congregacoesQuery]);

  if (supRes.error) {
    return NextResponse.json({ error: supRes.error.message }, { status: 500 });
  }
  if (congRes.error) {
    return NextResponse.json({ error: congRes.error.message }, { status: 500 });
  }

  // Campos: pagina em loop para ultrapassar o limite de 1000 linhas do PostgREST
  const pageSize = 1000;
  let from = 0;
  let allCampos: any[] = [];
  while (true) {
    const { data, error } = await camposQuery.range(from, from + pageSize - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const chunk = (data || []) as any[];
    allCampos = allCampos.concat(chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({
    supervisoes: supRes.data ?? [],
    campos: allCampos,
    congregacoes: congRes.data ?? [],
  });
}
