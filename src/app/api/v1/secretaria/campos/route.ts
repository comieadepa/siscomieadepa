import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';
import { canDelete } from '@/lib/auth/roles';

export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const id = searchParams.get('id');

  const supabase = createServerClient();
  let query = supabase.from('campos').select('*').order('nome');

  if (!includeInactive) {
    query = query.neq('is_active', false);
  }

  if (id) {
    const { data, error } = await query.eq('id', id).maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  }

  const pageSize = 1000;
  let from = 0;
  let all: any[] = [];

  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const chunk = (data || []) as any[];
    all = all.concat(chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({ data: all });
}

export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'secretaria');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null as any);
  if (!body) {
    return NextResponse.json({ error: 'Payload invalido.' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase.from('campos').insert([body]).select('*').maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void logDB({ userId: auth.ctx.userId, userEmail: auth.ctx.user.email ?? undefined, acao: 'criar', modulo: 'secretaria', entidade: 'campos', entidadeId: data?.id, descricao: `Campo criado: ${data?.nome ?? body.nome}`, detalhes: { nome: data?.nome ?? body.nome }, request });
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
    .from('campos')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void logDB({ userId: auth.ctx.userId, userEmail: auth.ctx.user.email ?? undefined, acao: 'editar', modulo: 'secretaria', entidade: 'campos', entidadeId: id, descricao: `Campo editado: ${data?.nome ?? id}`, detalhes: updates, request });
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

  // Buscar nome antes de deletar para registrar no log
  const { data: campoAntes } = await supabase.from('campos').select('nome').eq('id', id).maybeSingle();

  const { error } = await supabase.from('campos').delete().eq('id', id);
  if (error) {
    void logDB({ userId: auth.ctx.userId, userEmail: auth.ctx.user.email ?? undefined, acao: 'deletar', modulo: 'secretaria', entidade: 'campos', entidadeId: id, descricao: `Falha ao deletar campo: ${campoAntes?.nome ?? id}`, status: 'erro', mensagemErro: error.message, request });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void logDB({ userId: auth.ctx.userId, userEmail: auth.ctx.user.email ?? undefined, acao: 'deletar', modulo: 'secretaria', entidade: 'campos', entidadeId: id, descricao: `Campo deletado: ${campoAntes?.nome ?? id}`, detalhes: { id, nome: campoAntes?.nome }, request });
  return NextResponse.json({ success: true });
}
