import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { registrarHistoricoMinisterial } from '@/lib/historico-ministerial';
import { canDelete } from '@/lib/auth/roles';

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

  // Registrar automaticamente no histórico ministerial se houver member_id
  if (data?.member_id) {
    const tipoRegistro = String(body?.tipo_registro || '').toLowerCase();
    const categoria = String(body?.categoria_registro || '').toUpperCase();

    const CATEGORIAS_CONSAGRACAO = new Set([
      'CONSAGRAÇÃO', 'ORDENAÇÃO', 'INTEGRAÇÃO', 'REINTEGRAÇÃO', 'ENTRADA NO PROBATÓRIO', 'SAÍDA DO PROBATÓRIO',
    ]);

    const nomeUsuario =
      auth.ctx.user.user_metadata?.nome ||
      auth.ctx.user.user_metadata?.name ||
      auth.ctx.user.email || null;

    if (tipoRegistro === 'progressao') {
      const cargoAnterior = body?.cargo_anterior ? ` (cargo anterior: ${body.cargo_anterior})` : '';
      const cargoNovo = body?.cargo_ocupa || body?.cargo || '';
      await registrarHistoricoMinisterial({
        ministroId: data.member_id,
        tipo: 'progressao_ministerial',
        titulo: 'Progressão ministerial',
        descricao: `Progressão ministerial registrada${cargoNovo ? ` — novo cargo: ${cargoNovo}` : ''}${cargoAnterior}${data.numero_processo ? ` — processo: ${data.numero_processo}` : ''}.`,
        origem: 'consagracao',
        referenciaId: data.id,
        criadoPor: auth.ctx.userId,
        nomeUsuario,
      });
    } else if (CATEGORIAS_CONSAGRACAO.has(categoria)) {
      const cargo = body?.cargo || body?.cargo_ocupa || '';
      await registrarHistoricoMinisterial({
        ministroId: data.member_id,
        tipo: 'consagracao',
        titulo: categoria.charAt(0) + categoria.slice(1).toLowerCase(),
        descricao: `${categoria} registrada${cargo ? ` — cargo: ${cargo}` : ''}${data.numero_processo ? ` — processo: ${data.numero_processo}` : ''}.`,
        origem: 'consagracao',
        referenciaId: data.id,
        criadoPor: auth.ctx.userId,
        nomeUsuario,
      });
    }
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

  if (!canDelete(auth.ctx.role)) {
    return NextResponse.json({ error: 'Acesso Negado!' }, { status: 403 });
  }

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
