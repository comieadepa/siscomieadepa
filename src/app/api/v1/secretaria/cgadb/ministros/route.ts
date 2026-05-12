import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'cgadb');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const offset = Number(searchParams.get('offset') || '0');
  const limit = Number(searchParams.get('limit') || '1000');

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('members')
    .select('id,name,cpf,status,tipo_cadastro,celular,phone,whatsapp,cargo_ministerial,custom_fields')
    .or('status.eq.active,tipo_cadastro.eq.ministro')
    .order('name')
    .range(offset, offset + Math.max(limit, 1) - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const hasMore = (data?.length || 0) >= Math.max(limit, 1);
  return NextResponse.json({
    data: data ?? [],
    nextOffset: hasMore ? offset + Math.max(limit, 1) : null,
  });
}
