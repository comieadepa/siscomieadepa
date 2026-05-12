import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const campoNome = String(body?.campo_nome || '').trim();
  const supervisaoId = String(body?.supervisao_id || '').trim();
  const supervisaoNome = String(body?.supervisao_nome || '').trim();

  if (!campoNome || !supervisaoId) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const membrosParaSync: { id: string; custom_fields: any }[] = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data: chunk, error } = await supabase
      .from('members')
      .select('id, custom_fields')
      .filter('custom_fields->>campo', 'ilike', campoNome)
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!chunk || chunk.length === 0) break;
    membrosParaSync.push(...(chunk as any[]));
    if (chunk.length < PAGE) break;
    from += PAGE;
  }

  if (membrosParaSync.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const updates = membrosParaSync.map((m) => ({
    id: m.id,
    supervisao_id: supervisaoId,
    custom_fields: { ...(m.custom_fields || {}), supervisao: supervisaoNome || null },
  }));

  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const { error } = await supabase
      .from('members')
      .upsert(updates.slice(i, i + BATCH), { onConflict: 'id' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ updated: updates.length });
}
