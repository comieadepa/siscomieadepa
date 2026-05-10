import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// GET /api/eventos/[eventoId]/hospedagens
// Lista todas as hospedagens com dados do inscrito
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, status, prioridade, necessidade_especial, descricao_necessidade,
      cama_inferior, tipo_cama, numero_cama, observacoes, alocacao_automatica, created_at,
      alojamento_id,
      evento_alojamentos ( id, nome, publico ),
      inscricao_id,
      evento_inscricoes (
        id, nome_inscrito, cpf, sexo, data_nascimento,
        supervisao_id, campo_id, tipo_inscricao, status_pagamento,
        hosp_necessidade_especial, hosp_descricao_necessidade,
        hosp_cama_inferior, hosp_observacoes
      )
    `)
    .eq('evento_id', eventoId)
    .order('prioridade', { ascending: false })
    .order('created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Flatten nested Supabase join objects so the client sees flat fields
  type JoinRow = Record<string, unknown>;
  const hospedagens = (data ?? []).map(h => {
    const raw = h as unknown as Record<string, unknown>;
    const insc = raw.evento_inscricoes as JoinRow | null;
    const aloj = raw.evento_alojamentos as JoinRow | null;
    return {
      id:                    raw.id,
      inscricao_id:          raw.inscricao_id,
      alojamento_id:         raw.alojamento_id,
      status:                raw.status,
      prioridade:            raw.prioridade,
      necessidade_especial:  raw.necessidade_especial,
      descricao_necessidade: raw.descricao_necessidade,
      cama_inferior:         raw.cama_inferior,
      tipo_cama:             raw.tipo_cama,
      numero_cama:           raw.numero_cama,
      observacoes:           raw.observacoes,
      alocacao_automatica:   raw.alocacao_automatica,
      created_at:            raw.created_at,
      // Flattened from evento_inscricoes
      nome_inscrito:     insc?.nome_inscrito    ?? null,
      cpf:               insc?.cpf              ?? null,
      sexo:              insc?.sexo             ?? null,
      data_nascimento:   insc?.data_nascimento  ?? null,
      supervisao_id:     insc?.supervisao_id    ?? null,
      campo_id:          insc?.campo_id         ?? null,
      tipo_inscricao:    insc?.tipo_inscricao   ?? null,
      status_pagamento:  insc?.status_pagamento ?? null,
      // Flattened from evento_alojamentos
      alojamento_nome:   aloj?.nome             ?? null,
    };
  });
  return NextResponse.json({ hospedagens });
}

// POST /api/eventos/[eventoId]/hospedagens
// Cria registro de hospedagem manualmente (admin)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const body = await request.json();
  const { inscricao_id, alojamento_id, tipo_cama, status, prioridade,
          necessidade_especial, descricao_necessidade, cama_inferior,
          numero_cama, observacoes } = body;

  if (!inscricao_id) {
    return NextResponse.json({ error: 'inscricao_id obrigatório' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_hospedagens')
    .upsert([{
      evento_id:            eventoId,
      inscricao_id,
      alojamento_id:        alojamento_id || null,
      status:               status        ?? 'solicitada',
      prioridade:           prioridade    ?? 0,
      necessidade_especial: necessidade_especial ?? false,
      descricao_necessidade: descricao_necessidade ?? null,
      cama_inferior:        cama_inferior ?? false,
      tipo_cama:            tipo_cama     || null,
      numero_cama:          numero_cama   || null,
      observacoes:          observacoes   || null,
      alocacao_automatica:  false, // Manual
    }], { onConflict: 'inscricao_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ hospedagem: data });
}

// PATCH /api/eventos/[eventoId]/hospedagens
// Atualiza uma hospedagem (alterar alojamento, cama, status, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  // Se está alterando alojamento/cama manualmente, marca como não automático
  if (updates.alojamento_id !== undefined || updates.tipo_cama !== undefined) {
    updates.alocacao_automatica = false;
  }

  const supabase = createServerClient();

  // Verificar limite de vagas se está confirmando e mudando alojamento
  if (updates.alojamento_id && updates.status === 'confirmada') {
    const { data: aloj } = await supabase
      .from('evento_alojamentos')
      .select('total_vagas, camas_inferiores, camas_superiores')
      .eq('id', updates.alojamento_id)
      .single();

    if (aloj) {
      const { count: ocupTotal } = await supabase
        .from('evento_hospedagens')
        .select('id', { count: 'exact', head: true })
        .eq('alojamento_id', updates.alojamento_id)
        .eq('status', 'confirmada')
        .neq('id', id);

      if ((ocupTotal ?? 0) >= aloj.total_vagas) {
        return NextResponse.json(
          { error: 'Alojamento sem vagas disponíveis. Mude para lista de espera ou escolha outro alojamento.' },
          { status: 409 }
        );
      }

      if (updates.tipo_cama === 'inferior') {
        const { count: ocupInf } = await supabase
          .from('evento_hospedagens')
          .select('id', { count: 'exact', head: true })
          .eq('alojamento_id', updates.alojamento_id)
          .eq('tipo_cama', 'inferior')
          .eq('status', 'confirmada')
          .neq('id', id);

        if ((ocupInf ?? 0) >= aloj.camas_inferiores) {
          return NextResponse.json(
            { error: 'Sem camas inferiores disponíveis neste alojamento.' },
            { status: 409 }
          );
        }
      }
    }
  }

  const { error } = await supabase
    .from('evento_hospedagens')
    .update(updates)
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/eventos/[eventoId]/hospedagens?id=xxx
// Remove completamente um registro de hospedagem
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from('evento_hospedagens')
    .delete()
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
