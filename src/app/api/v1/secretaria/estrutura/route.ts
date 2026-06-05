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
