import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { canDelete } from '@/lib/auth/roles';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const membroId = searchParams.get('membro_id');

  const supabase = createServerClient();
  let query = supabase.from('hds').select('id,nome,sexo,data_nascimento,cpf,membro_id').order('nome');
  if (membroId) {
    query = query.eq('membro_id', membroId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  if (!body) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.from('hds').insert([body]).select('id,nome,sexo,data_nascimento,cpf,membro_id').maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  if (!canDelete(auth.ctx.role)) {
    return NextResponse.json({ error: 'Acesso Negado!' }, { status: 403 });
  }

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('hds').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
