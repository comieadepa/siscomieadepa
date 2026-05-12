import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('certificados_templates')
    .select('template_key,name,template_data,is_active,created_at,updated_at')
    .eq('ministry_id', auth.ctx.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const templates = (data ?? [])
    .map((row: any) => {
      const t = row?.template_data;
      if (!t) return null;
      return {
        ...t,
        id: t.id || row.template_key,
        nome: t.nome || row.name,
        ativo: row.is_active === true,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ data: templates });
}
