import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/hospedagens/emergencial/alocar
 * Alocação manual administrativa em leito emergencial.
 * Exclusivo para administradores e coordenação.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const body = await request.json().catch(() => ({}));
  const { inscricao_id, leito_id, observacao } = body;

  if (!inscricao_id || !leito_id) {
    return NextResponse.json({ error: 'inscricao_id e leito_id são obrigatórios.' }, { status: 400 });
  }

  try {
    // 1. Busca leito
    const { data: leito, error: errLeito } = await supabase
      .from('evento_hospedagem_leitos')
      .select('id, numero, tipo_leito, posicao, ocupado, inscricao_id, alojamento_id, evento_alojamentos(id, nome)')
      .eq('id', leito_id)
      .eq('evento_id', eventoId)
      .single();

    if (errLeito || !leito) {
      return NextResponse.json({ error: 'Leito não encontrado.' }, { status: 404 });
    }

    if (leito.ocupado && leito.inscricao_id) {
      return NextResponse.json({ error: `Leito ${leito.numero} já está ocupado por outro participante.` }, { status: 409 });
    }

    // 2. Busca inscrição
    const { data: inscricao, error: errInsc } = await supabase
      .from('evento_inscricoes')
      .select('id, nome_inscrito, cpf, tipo_inscricao, sexo, status_pagamento')
      .eq('id', inscricao_id)
      .eq('evento_id', eventoId)
      .single();

    if (errInsc || !inscricao) {
      return NextResponse.json({ error: 'Inscrição não encontrada.' }, { status: 404 });
    }

    // 3. Atualizar leito com lock lógico
    const { error: errUpdateLeito } = await supabase
      .from('evento_hospedagem_leitos')
      .update({
        ocupado: true,
        inscricao_id: inscricao.id,
      })
      .eq('id', leito_id)
      .eq('ocupado', false);

    if (errUpdateLeito) {
      return NextResponse.json({ error: 'Falha ao ocupar leito. Pode ter havido concorrência.' }, { status: 409 });
    }

    // 4. Upsert em evento_hospedagens
    const hospPayload: any = {
      evento_id: eventoId,
      inscricao_id: inscricao.id,
      alojamento_id: leito.alojamento_id,
      tipo_cama: leito.posicao,
      numero_cama: leito.numero,
      status: 'alocada',
      prioridade: 100,
      observacoes: observacao ? `[Emergencial] ${observacao}` : '[Emergencial] Alocação manual de contingência',
      alocacao_automatica: false,
    };

    const { error: errUpsertHosp } = await supabase
      .from('evento_hospedagens')
      .upsert([hospPayload], { onConflict: 'inscricao_id' });

    if (errUpsertHosp) {
      console.warn('[Emergencial] Aviso ao gravar em evento_hospedagens:', errUpsertHosp.message);
    }

    // 5. Garantir flag hospedagem = true na inscrição
    await supabase
      .from('evento_inscricoes')
      .update({ hospedagem: true })
      .eq('id', inscricao.id);

    // 6. Auditoria
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'alocacao_emergencial_manual',
      modulo: 'hospedagem',
      entidade: 'evento_hospedagem_leitos',
      entidadeId: leito_id,
      descricao: `[Emergencial] Participante "${inscricao.nome_inscrito}" alocado manualmente no leito ${leito.numero} (${(leito.evento_alojamentos as any)?.nome || 'Alojamento'}).`,
      detalhes: {
        inscricao_id: inscricao.id,
        nome_inscrito: inscricao.nome_inscrito,
        leito_id,
        leito_numero: leito.numero,
        alojamento_id: leito.alojamento_id,
        operador: guard.ctx.user?.email ?? 'coordenacao',
        observacao,
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      mensagem: `Participante ${inscricao.nome_inscrito} alocado com sucesso no Leito ${leito.numero}!`,
      leito_id,
      numero: leito.numero,
      alojamento_id: leito.alojamento_id,
    });
  } catch (error: any) {
    console.error('[Emergencial] Erro na alocação manual emergencial:', error);
    return NextResponse.json({ error: error.message || 'Erro interno na alocação emergencial.' }, { status: 500 });
  }
}
