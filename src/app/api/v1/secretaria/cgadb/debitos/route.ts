import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'cgadb');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const offset = Number(searchParams.get('offset') || '0');
  const limit = Number(searchParams.get('limit') || '1000');
  const orderBy = (searchParams.get('orderBy') || 'nome').toLowerCase();

  const supabase = createServerClient();
  let query = supabase
    .from('cgadb_debitos')
    .select('*');

  if (orderBy === 'ano') {
    query = query.order('ano', { ascending: false });
  } else {
    query = query.order('nome', { ascending: true });
  }

  query = query.range(offset, offset + Math.max(limit, 1) - 1);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const hasMore = (data?.length || 0) >= Math.max(limit, 1);
  return NextResponse.json({
    data: data ?? [],
    nextOffset: hasMore ? offset + Math.max(limit, 1) : null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'cgadb');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Nenhum registro informado.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('cgadb_debitos')
    .upsert(rows, { onConflict: 'cpf,ano', ignoreDuplicates: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: rows.length });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'cgadb');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const cpf = typeof body?.cpf === 'string' ? body.cpf : '';

  if (!cpf || ids.length === 0) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('cgadb_debitos')
    .update({ cpf })
    .in('id', ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, count: ids.length });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'cgadb');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  const deleteAll = body?.all === true;

  const supabase = createServerClient();

  let query = supabase.from('cgadb_debitos').delete();
  if (deleteAll) {
    query = query.neq('id', '00000000-0000-0000-0000-000000000000');
  } else if (ids.length > 0) {
    query = query.in('id', ids);
  } else {
    return NextResponse.json({ error: 'Nenhum id informado.' }, { status: 400 });
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
