import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const year = searchParams.get('year');
  const fieldsParam = searchParams.get('fields');
  const fields = fieldsParam
    ? fieldsParam.split(',').map((value) => value.trim()).filter(Boolean).join(',')
    : '*';

  const supabase = createServerClient();
  let query = supabase.from('consagracao_registros').select(fields).order('created_at', { ascending: false });

  if (year) {
    query = query.like('numero_processo', `%/${year}`);
  }

  if (id) {
    const { data, error } = await query.eq('id', id).maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  if (!body) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('consagracao_registros')
    .insert([body])
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const updates = { ...body } as Record<string, any>;
  delete updates.id;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('consagracao_registros')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const id = body?.id as string | undefined;
  if (!id) {
    return NextResponse.json({ error: 'Id invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('consagracao_registros').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
