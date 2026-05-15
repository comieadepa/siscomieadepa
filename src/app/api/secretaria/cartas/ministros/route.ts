import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ data: [] });
  }

  const supabase = createServerClient();
  const term = query.replace(/[%_]/g, '');
  const filters = [`name.ilike.%${term}%`, `matricula.ilike.%${term}%`];

  const { data, error } = await supabase
    .from('members')
    .select('id,name,cpf,rg,matricula,numero_cgadb,registro_comieadepa,custom_fields,status')
    .or('status.eq.active,tipo_cadastro.eq.ministro')
    .or(filters.join(','))
    .order('name')
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (data || []).map((item) => {
    const custom = (item.custom_fields || {}) as Record<string, unknown>;
    return {
      id: item.id,
      nome: item.name,
      cpf: item.cpf,
      rg: item.rg,
      matricula: item.matricula,
      numero_cgadb: item.numero_cgadb,
      registro_comieadepa: item.registro_comieadepa,
      supervisao: custom.supervisao || null,
      campo: custom.campo || null,
    };
  });

  return NextResponse.json({ data: result });
}
