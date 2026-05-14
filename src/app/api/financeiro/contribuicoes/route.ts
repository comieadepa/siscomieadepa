import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';

const FINANCEIRO_ROLES = ['super', 'financeiro'] as const;

// GET /api/financeiro/contribuicoes?ano=2026&supervisao_id=xxx&campo_id=xxx
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(request, FINANCEIRO_ROLES);
    if (!auth.ok) return auth.response;
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const ano = searchParams.get('ano');
    const supervisao_id = searchParams.get('supervisao_id');
    const campo_id = searchParams.get('campo_id');

    if (ano && Number.isNaN(Number(ano))) {
      return NextResponse.json({ error: 'ano invalido' }, { status: 400 });
    }

    let query = supabase
      .from('contribuicoes_estatutarias')
      .select('id,campo_id,campo_nome,supervisao_id,supervisao_nome,pastor_nome,mes,ano,valor,forma_pagamento,contato,created_at')
      .order('ano', { ascending: false })
      .order('campo_nome');

    if (ano) query = query.eq('ano', Number(ano));
    if (supervisao_id) query = query.eq('supervisao_id', supervisao_id);
    if (campo_id) query = query.eq('campo_id', campo_id);

    const { data, error } = await query;
    if (error) {
      console.error('[financeiro/contribuicoes] Supabase error:', error);
      return NextResponse.json(
        { error: `Falha ao buscar contribuicoes: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/financeiro/contribuicoes — registra (upsert por campo_id + mes + ano)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(request, FINANCEIRO_ROLES);
    if (!auth.ok) return auth.response;
    const supabase = createServerClient();
    const body = await request.json();
    const {
      campo_id, campo_nome, supervisao_id, supervisao_nome,
      pastor_member_id, pastor_nome,
      mes, ano, valor, forma_pagamento, contato,
    } = body;

    if (!campo_nome || !mes || !ano) {
      return NextResponse.json(
        { error: 'campo_nome, mes e ano são obrigatórios' },
        { status: 400 }
      );
    }
    if (mes < 1 || mes > 12) {
      return NextResponse.json({ error: 'Mês inválido (1–12)' }, { status: 400 });
    }

    // Upsert: verifica existência pelo campo_id + mes + ano
    if (campo_id) {
      const { data: existing } = await supabase
        .from('contribuicoes_estatutarias')
        .select('id')
        .eq('campo_id', campo_id)
        .eq('mes', mes)
        .eq('ano', ano)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from('contribuicoes_estatutarias')
          .update({ valor, forma_pagamento, contato, pastor_nome, pastor_member_id })
          .eq('id', existing.id)
          .select()
          .single();
        if (error) {
          await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'editar_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: existing.id, descricao: `Falha ao atualizar contribuição: ${campo_nome} ${mes}/${ano}`, status: 'erro', mensagemErro: error.message, request });
          return NextResponse.json(
            { error: `Falha ao atualizar contribuicao: ${error.message}` },
            { status: 500 }
          );
        }
        await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'editar_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: data.id, descricao: `Contribuição atualizada (upsert): ${campo_nome} — ${mes}/${ano}`, detalhes: { campo_nome, mes, ano, valor, forma_pagamento }, request });
        return NextResponse.json({ data, updated: true });
      }
    }

    const { data, error } = await supabase
      .from('contribuicoes_estatutarias')
      .insert({
        campo_id, campo_nome, supervisao_id, supervisao_nome,
        pastor_member_id, pastor_nome,
        mes, ano, valor, forma_pagamento, contato,
      })
      .select()
      .single();
    if (error) {
      await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'criar_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', descricao: `Falha ao registrar contribuição: ${campo_nome} ${mes}/${ano}`, status: 'erro', mensagemErro: error.message, request });
      return NextResponse.json(
        { error: `Falha ao registrar contribuicao: ${error.message}` },
        { status: 500 }
      );
    }

    await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'criar_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: data.id, descricao: `Contribuição registrada: ${campo_nome} — ${mes}/${ano} — R$ ${valor}`, detalhes: { campo_nome, supervisao_nome, mes, ano, valor, forma_pagamento, pastor_nome }, request });
    return NextResponse.json({ data, updated: false }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/financeiro/contribuicoes — edita valor, mes e forma_pagamento
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireRole(request, FINANCEIRO_ROLES);
    if (!auth.ok) return auth.response;
    const supabase = createServerClient();
    const body = await request.json();
    const { id, valor, mes, forma_pagamento } = body;

    if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });

    const updatePayload: Record<string, unknown> = {};
    if (valor !== undefined) updatePayload.valor = valor;
    if (mes !== undefined) updatePayload.mes = mes;
    if (forma_pagamento !== undefined) updatePayload.forma_pagamento = forma_pagamento;

    // Busca registro atual para dado anterior no log
    const { data: anterior } = await supabase
      .from('contribuicoes_estatutarias')
      .select('campo_nome, mes, ano, valor, forma_pagamento')
      .eq('id', id)
      .maybeSingle();

    const { data, error } = await supabase
      .from('contribuicoes_estatutarias')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'editar_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: id, descricao: `Falha ao editar contribuição id=${id}`, status: 'erro', mensagemErro: error.message, request });
      return NextResponse.json({ error: `Falha ao editar: ${error.message}` }, { status: 500 });
    }
    await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'editar_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: id, descricao: `Contribuição editada: ${data.campo_nome} — ${data.mes}/${data.ano}`, detalhes: { anterior: anterior ?? undefined, novo: updatePayload }, request });
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno' }, { status: 500 });
  }
}

// DELETE /api/financeiro/contribuicoes?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRole(request, FINANCEIRO_ROLES);
    if (!auth.ok) return auth.response;
    const supabase = createServerClient();
    const id = new URL(request.url).searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
    }

    // Busca antes de deletar para registrar no log
    const { data: registro } = await supabase
      .from('contribuicoes_estatutarias')
      .select('campo_nome, mes, ano, valor, forma_pagamento, supervisao_nome')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabase
      .from('contribuicoes_estatutarias')
      .delete()
      .eq('id', id);

    if (error) {
      await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'excluir_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: id, descricao: `Falha ao excluir contribuição id=${id}`, status: 'erro', mensagemErro: error.message, request });
      return NextResponse.json(
        { error: `Falha ao excluir contribuicao: ${error.message}` },
        { status: 500 }
      );
    }

    await logDB({ userId: auth.ctx.user.id, userEmail: auth.ctx.user.email, acao: 'excluir_lancamento', modulo: 'financeiro', entidade: 'contribuicoes_estatutarias', entidadeId: id, descricao: `Contribuição excluída: ${registro?.campo_nome ?? id} — ${registro?.mes}/${registro?.ano} — R$ ${registro?.valor}`, detalhes: registro ?? undefined, request });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
