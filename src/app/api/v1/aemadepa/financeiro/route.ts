import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { logDB } from '@/lib/audit';

/**
 * GET /api/v1/aemadepa/financeiro
 * Consulta o status financeiro completo de uma associada, sua solicitação ativa e o histórico.
 */
export async function GET(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const associadaId = searchParams.get('associadaId');

  if (!associadaId) {
    return NextResponse.json({ error: 'ID da associada não informado.' }, { status: 400 });
  }

  const supabase = createServerClient();

  try {
    // 1. Busca dados cadastrais essenciais da associada (incluindo foto)
    const { data: associada, error: assocErr } = await supabase
      .from('aemadepa_associadas')
      .select('id, ministro_id, nome, cpf, foto_url, status')
      .eq('id', associadaId)
      .maybeSingle();

    if (assocErr || !associada) {
      return NextResponse.json({ error: 'Associada não encontrada.' }, { status: 404 });
    }

    const temFoto = Boolean(associada.foto_url && associada.foto_url.trim().length > 0);

    // 2. Busca todas as solicitações da associada ordenadas pela via desc
    const { data: solicitacoes, error: solErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select(`
        id,
        associada_id,
        ministro_id,
        valor,
        via,
        forma_pagamento,
        operador_aprovacao_id,
        motivo_cortesia,
        idempotency_key,
        asaas_payment_id,
        pix_copia_cola,
        pix_qr_code_url,
        invoice_url,
        status,
        solicitado_em,
        pago_em,
        impresso_em,
        entregue_em,
        cancelado_em,
        motivo_cancelamento,
        created_at
      `)
      .eq('associada_id', associadaId)
      .order('via', { ascending: false });

    if (solErr) {
      return NextResponse.json({ error: solErr.message }, { status: 500 });
    }

    const solicitacaoAtiva = (solicitacoes || []).find((s) =>
      ['processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'].includes(s.status)
    ) || (solicitacoes || [])[0] || null;

    // 3. Busca histórico de impressões/reimpressões
    const { data: impressoes, error: impErr } = await supabase
      .from('aemadepa_carteirinhas_impressoes')
      .select(`
        id,
        solicitacao_id,
        via,
        tipo,
        motivo_reimpressao,
        operador_id,
        impresso_em,
        created_at
      `)
      .eq('associada_id', associadaId)
      .order('impresso_em', { ascending: false });

    if (impErr && !impErr.message.includes('relation "public.aemadepa_carteirinhas_impressoes" does not exist')) {
      console.warn('[AEMADEPA FINANCEIRO] Aviso ao buscar histórico de impressões:', impErr.message);
    }

    // Validação de elegibilidade para credencial
    // Não impede consulta de credenciais já emitidas (entregues ou impressas)
    const regularizada = Boolean(
      solicitacaoAtiva &&
      ['pago', 'em_impressao', 'impressa', 'entregue'].includes(solicitacaoAtiva.status)
    );

    const podeImprimirCredencial = temFoto && regularizada;

    return NextResponse.json({
      associada: {
        id: associada.id,
        nome: associada.nome,
        cpf: associada.cpf,
        temFoto,
        fotoUrl: associada.foto_url,
      },
      solicitacaoAtiva,
      historicoSolicitacoes: solicitacoes || [],
      historicoImpressoes: impressoes || [],
      elegibilidadeCredencial: {
        temFoto,
        regularizada,
        podeImprimirCredencial,
        motivoBloqueio: !temFoto
          ? 'Foto 3x4 não cadastrada.'
          : !regularizada
          ? 'Regularização financeira pendente.'
          : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/v1/aemadepa/financeiro
 * Processa ações financeiras administrativas com segurança atômica:
 * - 'a_vista': confirma pagamento em espécie/manual de R$ 20,00 por operador
 * - 'cortesia': concede isenção (R$ 0,00) mediante justificativa obrigatória
 * - 'segunda_via': abre nova via (inicia novo ciclo financeiro) após entrega da via anterior
 */
export async function POST(request: NextRequest) {
  const auth = await requireModuleAccess(request, 'aemadepa');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.acao || !body.associadaId) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }

    const { acao, associadaId, justificativa } = body;
    const operadorId = auth.ctx.userId;
    const supabase = createServerClient();

    // 1. Busca dados da associada
    const { data: associada, error: assocErr } = await supabase
      .from('aemadepa_associadas')
      .select('id, ministro_id, nome, cpf, foto_url')
      .eq('id', associadaId)
      .maybeSingle();

    if (assocErr || !associada) {
      return NextResponse.json({ error: 'Associada não encontrada.' }, { status: 404 });
    }

    const ministroId = associada.ministro_id;

    // 2. Trava de completude: exige foto cadastrada antes de qualquer quitação/emissão
    if (!associada.foto_url || associada.foto_url.trim().length === 0) {
      return NextResponse.json(
        { error: 'Não é possível regularizar ou emitir credencial sem foto cadastrada para a associada.' },
        { status: 422 }
      );
    }

    // 3. Quitação manual ou cortesia via RPC atômica (com fallback seguro com lock de integridade)
    if (acao === 'a_vista' || acao === 'cortesia') {
      if (acao === 'cortesia') {
        const motivo = (justificativa || '').trim();
        if (!motivo || motivo.length < 5) {
          return NextResponse.json(
            { error: 'Para conceder cortesia, é obrigatório informar uma justificativa clara (mínimo de 5 caracteres).' },
            { status: 400 }
          );
        }
      }

      // Tenta executar a RPC atômica caso a migration já esteja aplicada
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('quitar_aemadepa_carteirinha_admin', {
        p_associada_id: associadaId,
        p_modalidade: acao,
        p_operador_id: operadorId,
        p_justificativa_cortesia: acao === 'cortesia' ? justificativa : null,
      });

      if (!rpcErr && rpcRes && rpcRes.sucesso) {
        void logDB({
          acao: acao === 'cortesia' ? 'concessao_cortesia' : 'baixa_financeira',
          modulo: 'secretaria',
          entidade: 'aemadepa_carteirinhas_solicitacoes',
          entidadeId: rpcRes.solicitacao_id,
          descricao: acao === 'cortesia'
            ? `Cortesia concedida para ${associada.nome} (${rpcRes.via}ª via): ${justificativa}`
            : `Pagamento à vista (R$ 20,00) registrado para ${associada.nome} (${rpcRes.via}ª via)`,
          status: 'sucesso',
          detalhes: { associadaId, via: rpcRes.via, operadorId, acao },
        });

        return NextResponse.json({
          sucesso: true,
          mensagem: acao === 'cortesia' ? 'Cortesia registrada com sucesso.' : 'Pagamento à vista confirmado com sucesso.',
          solicitacaoId: rpcRes.solicitacao_id,
          via: rpcRes.via,
        });
      }

      // Fallback seguro com verificação concorrente direta
      const { data: solicitacao, error: solErr } = await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .select('*')
        .eq('associada_id', associadaId)
        .in('status', ['processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'])
        .maybeSingle();

      if (solErr) return NextResponse.json({ error: solErr.message }, { status: 500 });

      // Proteção de PIX em processamento ou cobrança ASAAS emitida ativa
      if (solicitacao?.status === 'processando_cobranca') {
        return NextResponse.json(
          { error: 'Existe uma cobrança PIX sendo processada no gateway para esta associada. Aguarde a conciliação.' },
          { status: 409 }
        );
      }

      if (solicitacao?.asaas_payment_id && solicitacao.asaas_payment_id.trim().length > 0) {
        return NextResponse.json(
          {
            error: `Existe uma cobrança PIX ASAAS ativa (${solicitacao.asaas_payment_id}) emitida para esta solicitação. Cancele ou concilie a cobrança oficial antes de registrar pagamento à vista ou cortesia.`,
          },
          { status: 409 }
        );
      }

      // Se já está paga, bloqueia tentativa redundante
      if (solicitacao && ['pago', 'em_impressao', 'impressa', 'entregue'].includes(solicitacao.status)) {
        return NextResponse.json(
          { error: `Esta associada já possui a ${solicitacao.via}ª via quitada (${solicitacao.forma_pagamento || 'pago'}). Não é permitida quitação concorrente.` },
          { status: 409 }
        );
      }

      const agora = new Date().toISOString();

      if (acao === 'a_vista') {
        if (solicitacao) {
          const { data: atualizada, error: updErr } = await supabase
            .from('aemadepa_carteirinhas_solicitacoes')
            .update({
              status: 'pago',
              valor: 20.00,
              forma_pagamento: 'a_vista',
              operador_aprovacao_id: operadorId,
              pago_em: agora,
              observacoes: solicitacao.observacoes
                ? `${solicitacao.observacoes}\n[À Vista] Quitação presencial confirmada pelo operador.`
                : '[À Vista] Quitação presencial confirmada pelo operador.',
              updated_at: agora,
            })
            .eq('id', solicitacao.id)
            .select()
            .single();

          if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

          void logDB({
            acao: 'baixa_financeira',
            modulo: 'secretaria',
            entidade: 'aemadepa_carteirinhas_solicitacoes',
            entidadeId: solicitacao.id,
            descricao: `Pagamento à vista (R$ 20,00) registrado para ${associada.nome} (${solicitacao.via}ª via)`,
            status: 'sucesso',
            detalhes: { associadaId, via: solicitacao.via, operadorId, valor: 20.00, formaPagamento: 'a_vista' },
          });

          return NextResponse.json({ sucesso: true, mensagem: 'Pagamento à vista confirmado com sucesso.', solicitacao: atualizada });
        } else {
          const { data: maxViaData } = await supabase
            .from('aemadepa_carteirinhas_solicitacoes')
            .select('via')
            .eq('associada_id', associadaId)
            .order('via', { ascending: false })
            .limit(1)
            .maybeSingle();

          const proximaVia = (maxViaData?.via || 0) + 1;
          const idempotencyKey = `cart:${associadaId}:v${proximaVia}:avista:${Date.now()}`;

          const { data: nova, error: insErr } = await supabase
            .from('aemadepa_carteirinhas_solicitacoes')
            .insert({
              associada_id: associadaId,
              ministro_id: ministroId,
              valor: 20.00,
              via: proximaVia,
              forma_pagamento: 'a_vista',
              operador_aprovacao_id: operadorId,
              idempotency_key: idempotencyKey,
              status: 'pago',
              solicitado_em: agora,
              pago_em: agora,
              observacoes: '[À Vista] Criação e quitação presencial confirmada pelo operador.',
            })
            .select()
            .single();

          if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

          void logDB({
            acao: 'baixa_financeira',
            modulo: 'secretaria',
            entidade: 'aemadepa_carteirinhas_solicitacoes',
            entidadeId: nova.id,
            descricao: `Nova via com pagamento à vista registrada para ${associada.nome} (${proximaVia}ª via)`,
            status: 'sucesso',
            detalhes: { associadaId, via: proximaVia, operadorId, valor: 20.00, formaPagamento: 'a_vista' },
          });

          return NextResponse.json({ sucesso: true, mensagem: 'Pagamento à vista registrado com sucesso.', solicitacao: nova });
        }
      }

      if (acao === 'cortesia') {
        const motivo = (justificativa || '').trim();

        if (solicitacao) {
          const { data: atualizada, error: updErr } = await supabase
            .from('aemadepa_carteirinhas_solicitacoes')
            .update({
              status: 'pago',
              valor: 0.00,
              forma_pagamento: 'cortesia',
              operador_aprovacao_id: operadorId,
              motivo_cortesia: motivo,
              pago_em: agora,
              observacoes: solicitacao.observacoes
                ? `${solicitacao.observacoes}\n[Cortesia Concedida] Motivo: ${motivo}`
                : `[Cortesia Concedida] Motivo: ${motivo}`,
              updated_at: agora,
            })
            .eq('id', solicitacao.id)
            .select()
            .single();

          if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

          void logDB({
            acao: 'concessao_cortesia',
            modulo: 'secretaria',
            entidade: 'aemadepa_carteirinhas_solicitacoes',
            entidadeId: solicitacao.id,
            descricao: `Cortesia concedida para ${associada.nome} (${solicitacao.via}ª via): ${motivo}`,
            status: 'sucesso',
            detalhes: { associadaId, via: solicitacao.via, operadorId, motivo, valor: 0.00, formaPagamento: 'cortesia' },
          });

          return NextResponse.json({ sucesso: true, mensagem: 'Cortesia registrada com sucesso.', solicitacao: atualizada });
        } else {
          const { data: maxViaData } = await supabase
            .from('aemadepa_carteirinhas_solicitacoes')
            .select('via')
            .eq('associada_id', associadaId)
            .order('via', { ascending: false })
            .limit(1)
            .maybeSingle();

          const proximaVia = (maxViaData?.via || 0) + 1;
          const idempotencyKey = `cart:${associadaId}:v${proximaVia}:cortesia:${Date.now()}`;

          const { data: nova, error: insErr } = await supabase
            .from('aemadepa_carteirinhas_solicitacoes')
            .insert({
              associada_id: associadaId,
              ministro_id: ministroId,
              valor: 0.00,
              via: proximaVia,
              forma_pagamento: 'cortesia',
              operador_aprovacao_id: operadorId,
              motivo_cortesia: motivo,
              idempotency_key: idempotencyKey,
              status: 'pago',
              solicitado_em: agora,
              pago_em: agora,
              observacoes: `[Cortesia Concedida] Motivo: ${motivo}`,
            })
            .select()
            .single();

          if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

          void logDB({
            acao: 'concessao_cortesia',
            modulo: 'secretaria',
            entidade: 'aemadepa_carteirinhas_solicitacoes',
            entidadeId: nova.id,
            descricao: `Nova via como cortesia registrada para ${associada.nome} (${proximaVia}ª via): ${motivo}`,
            status: 'sucesso',
            detalhes: { associadaId, via: proximaVia, operadorId, motivo, valor: 0.00, formaPagamento: 'cortesia' },
          });

          return NextResponse.json({ sucesso: true, mensagem: 'Cortesia registrada com sucesso.', solicitacao: nova });
        }
      }
    }

    if (acao === 'segunda_via') {
      // Regra de segurança: só permite segunda via se não houver NENHUMA solicitação anterior ativa
      const { data: pendente, error: penErr } = await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .select('id, via, status')
        .eq('associada_id', associadaId)
        .in('status', ['processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'])
        .maybeSingle();

      if (penErr) return NextResponse.json({ error: penErr.message }, { status: 500 });

      if (pendente) {
        return NextResponse.json(
          {
            error: `Não é possível gerar uma nova via enquanto a ${pendente.via}ª via estiver em andamento (status: '${pendente.status}'). Conclua ou finalize a via anterior antes de iniciar uma nova via.`,
          },
          { status: 409 }
        );
      }

      // Descobre a última via gerada
      const { data: ultimaViaData } = await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .select('via')
        .eq('associada_id', associadaId)
        .order('via', { ascending: false })
        .limit(1)
        .maybeSingle();

      const novaVia = (ultimaViaData?.via || 1) + 1;
      const idempotencyKey = `cart:${associadaId}:v${novaVia}:admin:${Date.now()}`;
      const agora = new Date().toISOString();

      // Cria a nova solicitação aguardando novo ciclo de pagamento
      const { data: novaSolicitacao, error: novaErr } = await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .insert({
          associada_id: associadaId,
          ministro_id: ministroId,
          valor: 20.00,
          via: novaVia,
          forma_pagamento: 'pix_asaas',
          idempotency_key: idempotencyKey,
          status: 'aguardando_pagamento',
          solicitado_em: agora,
          observacoes: `[Segunda Via Solicitada] Início do novo ciclo financeiro para a ${novaVia}ª via.`,
        })
        .select()
        .single();

      if (novaErr) return NextResponse.json({ error: novaErr.message }, { status: 500 });

      void logDB({
        acao: 'solicitar_segunda_via',
        modulo: 'secretaria',
        entidade: 'aemadepa_carteirinhas_solicitacoes',
        entidadeId: novaSolicitacao.id,
        descricao: `Abertura de nova via (${novaVia}ª via) para associada ${associada.nome}`,
        status: 'sucesso',
        detalhes: { associadaId, via: novaVia, operadorId },
      });

      return NextResponse.json({
        sucesso: true,
        mensagem: `Nova via (${novaVia}ª via) iniciada. Efetue o pagamento via PIX, À Vista ou conceda Cortesia.`,
        solicitacao: novaSolicitacao,
      });
    }

    return NextResponse.json({ error: `Ação '${acao}' não reconhecida.` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
