import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

/**
 * GET /api/eventos/[eventoId]/hospedagens/leitos
 * Lista todos os leitos do evento com alojamento, inscrito e status operacional.
 * Acesso: 'hospedagem_checkin' (disponível para perfis Hospedagem e Check-in Hospedagem).
 *
 * DELETE /api/eventos/[eventoId]/hospedagens/leitos
 * Libera um leito: ocupado=false, inscricao_id=null.
 * Acesso: 'hospedagem' (exclusivo Administrador).
 * Body: { id: string }
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem_checkin');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  // Busca todos os leitos com paginação para superar o limite de 1000 registros do Supabase PostgREST
  const PAGE_SIZE = 1000;
  let rawLeitos: any[] = [];
  let from = 0;

  while (true) {
    const { data: chunk, error } = await supabase
      .from('evento_hospedagem_leitos')
      .select(`
        id, numero, tipo_leito, posicao, ocupado, created_at,
        alojamento_id,
        evento_alojamentos ( id, nome, publico ),
        inscricao_id,
        evento_inscricoes ( id, nome_inscrito, cpf, tipo_inscricao, status_pagamento, hosp_possui_comorbidade, hosp_descricao_comorbidade, hosp_necessidade_especial, hosp_descricao_necessidade )
      `)
      .eq('evento_id', eventoId)
      .order('alojamento_id', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!chunk || chunk.length === 0) break;
    rawLeitos.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const inscricaoIds = Array.from(new Set(rawLeitos.map((l: any) => l.inscricao_id).filter(Boolean)));

  const hospMap = new Map<string, any>();
  if (inscricaoIds.length > 0) {
    // PostgREST tem limitação na cláusula .in() com URLs longas (> 100-200 UUIDs)
    const CHUNK_SIZE = 100;
    for (let i = 0; i < inscricaoIds.length; i += CHUNK_SIZE) {
      const chunkIds = inscricaoIds.slice(i, i + CHUNK_SIZE);
      const { data: hospData, error: errHosp } = await supabase
        .from('evento_hospedagens')
        .select('id, inscricao_id, status, checkin_at, checkout_at, checkin_operador, checkout_operador')
        .eq('evento_id', eventoId)
        .in('inscricao_id', chunkIds);

      if (!errHosp && hospData) {
        ((hospData as any[]) ?? []).forEach((h: any) => {
          hospMap.set(h.inscricao_id, h);
        });
      }
    }
  }

  const leitosCompletos = rawLeitos.map((l: any) => ({
    ...l,
    hospedagem: l.inscricao_id ? hospMap.get(l.inscricao_id) ?? null : null,
  }));

  return NextResponse.json({ leitos: leitosCompletos });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const { id } = body as { id?: string };
  if (!id) return NextResponse.json({ error: 'ID do leito obrigatório.' }, { status: 400 });

  const { error } = await supabase
    .from('evento_hospedagem_leitos')
    .update({ ocupado: false, inscricao_id: null })
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
