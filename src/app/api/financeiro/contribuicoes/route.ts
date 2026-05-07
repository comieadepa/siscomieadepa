import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// GET /api/financeiro/contribuicoes?ano=2026&supervisao_id=xxx&campo_id=xxx
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const ano = searchParams.get('ano');
    const supervisao_id = searchParams.get('supervisao_id');
    const campo_id = searchParams.get('campo_id');

    let query = supabase
      .from('contribuicoes_estatutarias')
      .select('*')
      .order('ano', { ascending: false })
      .order('campo_nome');

    if (ano) query = query.eq('ano', parseInt(ano));
    if (supervisao_id) query = query.eq('supervisao_id', supervisao_id);
    if (campo_id) query = query.eq('campo_id', campo_id);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/financeiro/contribuicoes — registra (upsert por campo_id + mes + ano)
export async function POST(request: NextRequest) {
  try {
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
        if (error) throw new Error(error.message);
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
    if (error) throw new Error(error.message);

    return NextResponse.json({ data, updated: false }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/financeiro/contribuicoes?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const id = new URL(request.url).searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
    }

    const { error } = await supabase
      .from('contribuicoes_estatutarias')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
