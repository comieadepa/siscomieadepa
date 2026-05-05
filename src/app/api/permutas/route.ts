import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// GET /api/permutas — lista todas as permutas
// POST /api/permutas — registra nova permuta e aplica mudanças em cascata
// DELETE /api/permutas?id=xxx — remove permuta (sem reverter mudanças)

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const ano = searchParams.get('ano');

    let query = supabase
      .from('permutas')
      .select('*')
      .order('ano', { ascending: false })
      .order('codigo_processo', { ascending: false });

    if (ano) query = query.eq('ano', parseInt(ano));

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return NextResponse.json({ data: data || [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await request.json();

    const {
      data_processo,
      ministro_id,
      ministro_nome,
      ministro_matricula,
      ministro_cpf,
      supervisao_origem_id,
      supervisao_origem_nome,
      campo_origem_id,
      campo_origem_nome,
      supervisao_destino_id,
      supervisao_destino_nome,
      campo_destino_id,
      campo_destino_nome,
      data_posse,
    } = body;

    if (!ministro_id || !campo_destino_id || !supervisao_destino_id) {
      return NextResponse.json(
        { error: 'ministro_id, campo_destino_id e supervisao_destino_id são obrigatórios' },
        { status: 400 }
      );
    }

    const ano = new Date().getFullYear();

    // Gerar próximo código de processo para o ano
    const { data: ultimo } = await supabase
      .from('permutas')
      .select('codigo_processo')
      .eq('ano', ano)
      .order('codigo_processo', { ascending: false })
      .limit(1)
      .single();

    const codigo_processo = ultimo ? (ultimo.codigo_processo + 1) : 1;

    // 1. Buscar pastor atual do campo destino (para desmarcar pastorPresidente)
    const { data: campoDestino } = await supabase
      .from('campos')
      .select('pastor_member_id')
      .eq('id', campo_destino_id)
      .single();

    const pastorAnteriorId = campoDestino?.pastor_member_id;

    // 2. Desmarcar pastor_presidente do pastor anterior (se existir e for diferente)
    if (pastorAnteriorId && pastorAnteriorId !== ministro_id) {
      const { data: pastorAnterior } = await supabase
        .from('members')
        .select('custom_fields')
        .eq('id', pastorAnteriorId)
        .single();

      const cfAnterior = (pastorAnterior?.custom_fields && typeof pastorAnterior.custom_fields === 'object')
        ? pastorAnterior.custom_fields
        : {};

      await supabase
        .from('members')
        .update({
          pastor_presidente: false,
          custom_fields: { ...cfAnterior, pastorPresidente: false },
        })
        .eq('id', pastorAnteriorId);
    }

    // 3. Atualizar o ministro da permuta: novo campo/supervisão + marcar como pastor presidente
    const { data: ministroAtual } = await supabase
      .from('members')
      .select('custom_fields')
      .eq('id', ministro_id)
      .single();

    const cfMinistro = (ministroAtual?.custom_fields && typeof ministroAtual.custom_fields === 'object')
      ? ministroAtual.custom_fields
      : {};

    await supabase
      .from('members')
      .update({
        pastor_presidente: true,
        custom_fields: {
          ...cfMinistro,
          pastorPresidente: true,
          supervisao: supervisao_destino_nome,
          campo: campo_destino_nome,
        },
      })
      .eq('id', ministro_id);

    // 4. Atualizar tabela campos com novo pastor
    await supabase
      .from('campos')
      .update({
        pastor_member_id: ministro_id,
        presidente_nome: ministro_nome,
        pastor_data_posse: data_posse || null,
      })
      .eq('id', campo_destino_id);

    // 5. Registrar a permuta
    const { data: permuta, error: insertError } = await supabase
      .from('permutas')
      .insert({
        codigo_processo,
        ano,
        data_processo: data_processo || null,
        ministro_id,
        ministro_nome,
        ministro_matricula: ministro_matricula || '',
        ministro_cpf: ministro_cpf || '',
        supervisao_origem_id: supervisao_origem_id || null,
        supervisao_origem_nome: supervisao_origem_nome || '',
        campo_origem_id: campo_origem_id || null,
        campo_origem_nome: campo_origem_nome || '',
        supervisao_destino_id,
        supervisao_destino_nome,
        campo_destino_id,
        campo_destino_nome,
        data_posse: data_posse || null,
      })
      .select()
      .single();

    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({ data: permuta, codigo_processo, ano });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

    const { error } = await supabase.from('permutas').delete().eq('id', id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
