import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  const mode = body?.mode === 'insert' ? 'insert' : 'upsert';
  const onConflict = typeof body?.onConflict === 'string' ? body.onConflict : 'cpf';

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  if (mode === 'insert') {
    const { error } = await supabase.from('members').insert(rows as any);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ inserted: rows.length });
  }

  const { error } = await supabase
    .from('members')
    .upsert(rows as any, { onConflict, ignoreDuplicates: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: rows.length });
}
