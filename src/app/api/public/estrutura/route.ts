import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeCongregacoes = searchParams.get('includeCongregacoes') === 'true';
  const includeCamposInactive = searchParams.get('includeCamposInactive') === 'true';

  const supabase = createServerClient();

  const supervisoesQuery = supabase
    .from('supervisoes')
    .select('id,nome')
    .neq('is_active', false)
    .order('nome');

  const camposQuery = includeCamposInactive
    ? supabase
      .from('campos')
      .select('id,nome,supervisao_id,is_campo_missionario')
      .order('nome')
    : supabase
      .from('campos')
      .select('id,nome,supervisao_id,is_campo_missionario')
      .neq('is_active', false)
      .order('nome');

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
