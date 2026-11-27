import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const {
      operacao_id,
      nome_inscrito,
      cpf,
      email,
      whatsapp,
      tipo_inscricao_id,
      modalidade_nome,
      valor_original,
      operador_nome,
      operador_email,
      inscricao_id,
    } = body;

    // 1. Validações básicas de payload
    if (!operacao_id || typeof operacao_id !== 'string') {
      return NextResponse.json({ error: 'Identificador único da operação é obrigatório.' }, { status: 400 });
    }
    if (!nome_inscrito || typeof nome_inscrito !== 'string' || !nome_inscrito.trim()) {
      return NextResponse.json({ error: 'Nome do participante é obrigatório.' }, { status: 400 });
    }
    if (!modalidade_nome || typeof modalidade_nome !== 'string' || !modalidade_nome.trim()) {
      return NextResponse.json({ error: 'Modalidade de inscrição é obrigatória.' }, { status: 400 });
    }

    const valorOriginalNum = Number(valor_original);
    if (isNaN(valorOriginalNum) || valorOriginalNum <= 0) {
      return NextResponse.json({ error: 'Valor original deve ser maior que zero para solicitar desconto.' }, { status: 400 });
    }

    const valorOriginalFix = Math.round(valorOriginalNum * 100) / 100;
    const admin = guard.ctx.supabaseAdmin;

    // Se for solicitação retroativa vinculada a uma inscrição existente
    if (inscricao_id) {
      const { data: insDb, error: insErr } = await admin
        .from('evento_inscricoes')
        .select('id, nome_inscrito, cpf, valor_pago, valor_original, valor_final, status_pagamento, forma_pagamento, tipo_inscricao, caixa_sessao_id')
        .eq('id', inscricao_id)
        .eq('evento_id', eventoId)
        .maybeSingle();

      if (insErr || !insDb) {
        return NextResponse.json({ error: 'Inscrição informada para desconto retroativo não foi encontrada.' }, { status: 404 });
      }

      if (insDb.status_pagamento !== 'pago') {
        return NextResponse.json({ error: `Desconto retroativo só pode ser aplicado a inscrições com status pago (atual: ${insDb.status_pagamento}).` }, { status: 400 });
      }

      const valPagoAtual = Number(insDb.valor_pago ?? insDb.valor_final ?? 0);
      if (valPagoAtual <= 0) {
        return NextResponse.json({ error: 'Inscrição já está isenta ou com valor pago zerado. Não é aplicável desconto retroativo.' }, { status: 400 });
      }
    }

    // 2. Impedir solicitações pendentes duplicadas para a mesma operação ou mesma inscrição
    let queryPendente = admin
      .from('evento_desconto_autorizacoes')
      .select('id, status, created_at')
      .eq('evento_id', eventoId)
      .eq('status', 'pendente');

    if (inscricao_id) {
      queryPendente = queryPendente.or(`operacao_id.eq.${operacao_id.trim()},inscricao_id.eq.${inscricao_id}`);
    } else {
      queryPendente = queryPendente.eq('operacao_id', operacao_id.trim());
    }

    const { data: existentePendente } = await queryPendente.maybeSingle();

    if (existentePendente) {
      return NextResponse.json(
        {
          error: 'Já existe uma solicitação de desconto pendente para esta operação/inscrição. Aguarde a deliberação ou cancele-a.',
          solicitacao_id: existentePendente.id
        },
        { status: 409 }
      );
    }

    // 3. Obter dados do operador a partir do contexto de autenticação
    const opNome = operador_nome?.trim() || (guard.ctx.equipe?.id ? 'Operador Balcão' : (guard.ctx.user?.user_metadata?.full_name || guard.ctx.user?.user_metadata?.nome || guard.ctx.user?.email || 'Operador Balcão'));
    const opEmail = operador_email?.trim() || guard.ctx.user?.email || null;
    const opId = guard.ctx.equipe?.id || guard.ctx.user?.id || null;

    // Formatar motivo destacando Desconto Retroativo se for o caso
    const prefixoRetroativo = inscricao_id ? '[Desconto retroativo] ' : '';
    const motivoFinal = (prefixoRetroativo + (body.motivo_solicitacao?.trim() || '')).trim() || (inscricao_id ? 'Desconto retroativo balcão' : null);

    // 4. Inserir solicitação no banco com suporte resiliente ao schema (solicitante_* e operador_*)
    const insertPayload: Record<string, any> = {
      evento_id: eventoId,
      operacao_id: operacao_id.trim(),
      inscricao_id: inscricao_id || null,
      nome_inscrito: nome_inscrito.trim().toUpperCase(),
      cpf: cpf ? String(cpf).replace(/\D/g, '') : null,
      email: email ? String(email).trim().toLowerCase() : null,
      whatsapp: whatsapp ? String(whatsapp).replace(/\D/g, '') : null,
      tipo_inscricao_id: tipo_inscricao_id || null,
      modalidade_nome: modalidade_nome.trim(),
      valor_original: valorOriginalFix,
      valor_desconto: 0.00,
      valor_final: valorOriginalFix,
      status: 'pendente',
      // Campos do schema em produção
      solicitante_operador_id: opId,
      solicitante_nome: opNome,
      solicitante_email: opEmail,
      motivo_solicitacao: motivoFinal,
      // Campos legados/aliases (se presentes no schema)
      operador_id: opId,
      operador_nome: opNome,
      operador_email: opEmail,
    };

    let { data: novaSolicitacao, error: insertErr } = await admin
      .from('evento_desconto_autorizacoes')
      .insert(insertPayload)
      .select('*')
      .single();

    // Se falhar por coluna não encontrada (ex: cache ou versão do schema), tenta payload canônico puro
    if (insertErr && (insertErr.message?.includes('column') || insertErr.code === 'PGRST204')) {
      const fallbackPayload: Record<string, any> = {
        evento_id: eventoId,
        operacao_id: operacao_id.trim(),
        inscricao_id: inscricao_id || null,
        nome_inscrito: nome_inscrito.trim().toUpperCase(),
        cpf: cpf ? String(cpf).replace(/\D/g, '') : null,
        email: email ? String(email).trim().toLowerCase() : null,
        whatsapp: whatsapp ? String(whatsapp).replace(/\D/g, '') : null,
        tipo_inscricao_id: tipo_inscricao_id || null,
        modalidade_nome: modalidade_nome.trim(),
        valor_original: valorOriginalFix,
        valor_desconto: 0.00,
        valor_final: valorOriginalFix,
        status: 'pendente',
        solicitante_operador_id: opId,
        solicitante_nome: opNome,
        solicitante_email: opEmail,
        motivo_solicitacao: motivoFinal,
      };

      const retryRes = await admin
        .from('evento_desconto_autorizacoes')
        .insert(fallbackPayload)
        .select('*')
        .single();

      if (!retryRes.error && retryRes.data) {
        novaSolicitacao = retryRes.data;
        insertErr = null;
      }
    }

    if (insertErr || !novaSolicitacao) {
      console.error('[DESCONTO SOLICITAR] Erro ao gravar solicitação:', insertErr);
      return NextResponse.json({ error: 'Erro ao registrar solicitação de desconto.', details: insertErr?.message }, { status: 500 });
    }

    void logDB({
      userId: guard.ctx.user?.id,
      userEmail: opEmail || undefined,
      acao: 'solicitar_desconto_balcao',
      modulo: 'eventos',
      entidade: 'evento_desconto_autorizacoes',
      entidadeId: novaSolicitacao.id,
      descricao: `Solicitação de desconto para ${nome_inscrito} no valor original de R$ ${valorOriginalFix.toFixed(2)}.`,
      status: 'sucesso',
      detalhes: {
        evento_id: eventoId,
        solicitacao_id: novaSolicitacao.id,
        operacao_id,
        valor_original: valorOriginalFix,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      solicitacao: novaSolicitacao,
    });
  } catch (err: any) {
    console.error('[DESCONTO SOLICITAR] Falha geral:', err);
    return NextResponse.json({ error: 'Falha interna ao processar solicitação de desconto.' }, { status: 500 });
  }
}
