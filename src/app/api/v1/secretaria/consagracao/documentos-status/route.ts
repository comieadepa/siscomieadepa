import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const idsRaw = searchParams.get('ids') || '';
  const ids = idsRaw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 500);

  if (ids.length === 0) {
    return NextResponse.json({ data: {} });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('candidato_documentos')
    .select('candidato_id, tipo_documento')
    .in('candidato_id', ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result: Record<string, { total: number; tipos: string[] }> = {};
  for (const id of ids) {
    result[id] = { total: 0, tipos: [] };
  }

  for (const row of data || []) {
    const candidatoId = String((row as any).candidato_id || '');
    if (!candidatoId) continue;
    if (!result[candidatoId]) result[candidatoId] = { total: 0, tipos: [] };
    result[candidatoId].total += 1;
    const tipo = String((row as any).tipo_documento || '').toUpperCase();
    if (tipo && !result[candidatoId].tipos.includes(tipo)) {
      result[candidatoId].tipos.push(tipo);
    }
  }

  return NextResponse.json({ data: result });
}
