import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeCongregacoes = searchParams.get('includeCongregacoes') === 'true';
  const includeCamposInactive = searchParams.get('includeCamposInactive') === 'true';
  // supervisao_id: quando fornecido, retorna apenas campos daquela supervisão
  // (evita o limite de 1000 linhas do Supabase/PostgREST ao buscar on-demand)
  const supervisaoId = searchParams.get('supervisao_id');

  const supabase = createServerClient();

  const supervisoesQuery = supabase
    .from('supervisoes')
    .select('id,nome')
    .neq('is_active', false)
    .order('nome')
    .limit(9999);

  let camposBase = supabase
    .from('campos')
    .select('id,nome,supervisao_id,is_campo_missionario')
    .order('nome')
    .limit(9999);

  if (supervisaoId) {
    camposBase = camposBase.eq('supervisao_id', supervisaoId);
  }
  if (!includeCamposInactive) {
    camposBase = camposBase.neq('is_active', false);
  }

  const camposQuery = camposBase;

  const congregacoesQuery = includeCongregacoes
    ? supabase
      .from('congregacoes')
      .select('id,nome,campo_id')
      .neq('is_active', false)
      .order('nome')
    : null;

  const [supRes, camRes, congRes] = await Promise.all([
    supervisoesQuery,
    camposQuery,
    includeCongregacoes && congregacoesQuery ? congregacoesQuery : Promise.resolve({ data: [] as any[], error: null })
  ]);

  if (supRes.error) {
    return NextResponse.json({ error: supRes.error.message }, { status: 500 });
  }

  if (camRes.error) {
    return NextResponse.json({ error: camRes.error.message }, { status: 500 });
  }

  if (congRes?.error) {
    return NextResponse.json({ error: congRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    supervisoes: supRes.data ?? [],
    campos: camRes.data ?? [],
    congregacoes: congRes?.data ?? [],
  });
}
