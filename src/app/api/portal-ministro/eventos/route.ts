/**
 * GET /api/portal-ministro/eventos
 * Retorna as inscrições do ministro autenticado com dados completos de:
 * - Evento (nome, datas, local, cidade, banner, status)
 * - Inscrição e Pagamento (status, valor, fatura, PIX)
 * - Crachá Virtual (QR code, check-in)
 * - Hospedagem & Leito (alojamento, quarto/leito, posição, check-in)
 * - Refeições (total, usadas, saldo)
 * E lista de eventos futuros abertos para inscrição.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  // 1. Busca dados do ministro para obter ID e CPF limpo
  const { data: ministro, error: mErr } = await supabase
    .from('members')
    .select('id, name, cpf')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (mErr || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  const cpfLimpo = (ministro.cpf || '').replace(/\D/g, '');

  // 2. Busca inscrições do ministro em evento_inscricoes
  let inscricoesQuery = supabase
    .from('evento_inscricoes')
    .select(`
      id,
      evento_id,
      ministro_id,
      nome_inscrito,
      cpf,
      email,
      telefone,
      whatsapp,
      tipo_inscricao,
      status_pagamento,
      valor_final,
      valor_pago,
      forma_pagamento,
      invoice_url,
      pix_copia_cola,
      pix_qr_code,
      asaas_due_date,
      qr_code,
      checkin_realizado,
      checkin_at,
      hospedagem,
      alimentacao,
      brinde,
      quantidade_refeicoes_total,
      quantidade_refeicoes_usadas,
      quantidade_refeicoes_saldo,
      refeicoes_total,
      refeicoes_utilizadas,
      hosp_necessidade_especial,
      hosp_cama_inferior,
      hosp_observacoes,
      grupo_hospedagem,
      created_at,
      eventos (
        id,
        nome,
        slug,
        departamento,
        data_inicio,
        data_fim,
        local,
        cidade,
        banner_url,
        status,
        inscricoes_abertas
      )
    `)
    .order('created_at', { ascending: false });

  if (cpfLimpo) {
    inscricoesQuery = inscricoesQuery.or(`ministro_id.eq.${ministro.id},cpf.eq.${cpfLimpo}`);
  } else {
    inscricoesQuery = inscricoesQuery.eq('ministro_id', ministro.id);
  }

  const { data: inscricoes, error: inscErr } = await inscricoesQuery;

  if (inscErr) {
    console.error('[portal-ministro/eventos] Erro ao buscar inscrições:', inscErr.message);
    return NextResponse.json({ error: 'Erro ao carregar inscrições.' }, { status: 500 });
  }

  const inscricoesIds = (inscricoes || []).map((i) => i.id);

  // 3. Busca detalhes de leitos alocados em evento_hospedagem_leitos
  const leitosMap = new Map<string, any>();
  if (inscricoesIds.length > 0) {
    const { data: leitos } = await supabase
      .from('evento_hospedagem_leitos')
      .select(`
        id,
        inscricao_id,
        numero,
        tipo_leito,
        posicao,
        evento_alojamentos (
          id,
          nome,
          setor,
          tipo,
          endereco
        )
      `)
      .in('inscricao_id', inscricoesIds);

    if (leitos) {
      for (const leito of leitos) {
        if (leito.inscricao_id) {
          leitosMap.set(leito.inscricao_id, leito);
        }
      }
    }
  }

  // 4. Busca status de check-in de hospedagem em evento_hospedagens
  const hospedagensMap = new Map<string, any>();
  if (inscricoesIds.length > 0) {
    const { data: hosps } = await supabase
      .from('evento_hospedagens')
      .select('id, inscricao_id, status, checkin_at, checkout_at')
      .in('inscricao_id', inscricoesIds);

    if (hosps) {
      for (const h of hosps) {
        if (h.inscricao_id) {
          hospedagensMap.set(h.inscricao_id, h);
        }
      }
    }
  }

  // 5. Monta a lista formatada de inscrições do ministro
  const minhasInscricoes = (inscricoes || []).map((insc: any) => {
    const ev = insc.eventos || {};
    const leito = leitosMap.get(insc.id);
    const hosp = hospedagensMap.get(insc.id);
    const alojamento = leito?.evento_alojamentos;

    // Refeições: normalização dos campos legados e novos
    const totalRef = Number(
      insc.quantidade_refeicoes_total ?? insc.refeicoes_total ?? (ev.departamento === 'AGO' && insc.alimentacao ? 12 : 0),
    );
    const usadasRef = Number(insc.quantidade_refeicoes_usadas ?? insc.refeicoes_utilizadas ?? 0);
    const saldoRef = Number(
      insc.quantidade_refeicoes_saldo ?? Math.max(0, totalRef - usadasRef),
    );

    return {
      id: insc.id,
      nomeInscrito: insc.nome_inscrito,
      cpf: insc.cpf,
      tipoInscricao: insc.tipo_inscricao || 'participante',
      statusPagamento: insc.status_pagamento || 'pendente',
      valorFinal: insc.valor_final ?? insc.valor_pago ?? 0,
      formaPagamento: insc.forma_pagamento ?? null,
      createdAt: insc.created_at,

      // 1. Dados do Evento
      evento: {
        id: ev.id ?? insc.evento_id,
        nome: ev.nome ?? 'Evento',
        slug: ev.slug ?? '',
        departamento: ev.departamento ?? '',
        dataInicio: ev.data_inicio ?? null,
        dataFim: ev.data_fim ?? null,
        local: ev.local ?? '',
        cidade: ev.cidade ?? '',
        bannerUrl: ev.banner_url ?? null,
        status: ev.status ?? 'programado',
      },

      // 2. Pagamento / Fatura
      pagamento: {
        status: insc.status_pagamento || 'pendente',
        valor: insc.valor_final ?? insc.valor_pago ?? 0,
        forma: insc.forma_pagamento ?? null,
        invoiceUrl: insc.invoice_url ?? null,
        pixCopiaCola: insc.pix_copia_cola ?? null,
        pixQrCode: insc.pix_qr_code ?? null,
        vencimento: insc.asaas_due_date ?? null,
      },

      // 3. Crachá & Presença
      cracha: {
        qrCode: insc.qr_code ?? null,
        checkinRealizado: !!insc.checkin_realizado,
        checkinAt: insc.checkin_at ?? null,
      },

      // 4. Hospedagem & Leito
      hospedagem: {
        solicitada: !!insc.hospedagem,
        alojamentoNome: alojamento?.nome ?? null,
        setor: alojamento?.setor ?? null,
        endereco: alojamento?.endereco ?? null,
        numeroLeito: leito?.numero ?? null,
        tipoLeito: leito?.tipo_leito ?? null,
        posicao: leito?.posicao ?? null,
        statusHospedagem: hosp?.status ?? (leito ? 'alocada' : (insc.hospedagem ? 'solicitada' : 'nao_solicitada')),
        checkinRealizado: !!(hosp?.checkin_at || hosp?.status === 'checkin_realizado'),
        checkinAt: hosp?.checkin_at ?? null,
        necessidadeEspecial: !!insc.hosp_necessidade_especial,
        camaInferior: !!insc.hosp_cama_inferior,
      },

      // 5. Refeições
      refeicoes: {
        contratada: !!insc.alimentacao,
        total: totalRef,
        usadas: usadasRef,
        saldo: saldoRef,
      },
    };
  });

  // 6. Busca eventos futuros com inscrições abertas onde o ministro NÃO possui inscrição
  const hoje = new Date().toISOString().slice(0, 10);
  const eventosInscritosIds = (inscricoes || []).map((i) => i.evento_id).filter(Boolean);

  let eventosAbertosQuery = supabase
    .from('eventos')
    .select(`
      id,
      nome,
      slug,
      departamento,
      data_inicio,
      data_fim,
      local,
      cidade,
      banner_url,
      valor_inscricao,
      permite_hospedagem,
      permite_alimentacao,
      inscricoes_abertas,
      status
    `)
    .eq('inscricoes_abertas', true)
    .gte('data_fim', hoje)
    .in('status', ['programado', 'aberto', 'confirmado'])
    .order('data_inicio', { ascending: true });

  if (eventosInscritosIds.length > 0) {
    eventosAbertosQuery = eventosAbertosQuery.not('id', 'in', `(${eventosInscritosIds.join(',')})`);
  }

  const { data: eventosAbertos } = await eventosAbertosQuery;

  return NextResponse.json({
    ministro: {
      id: ministro.id,
      nome: ministro.name,
    },
    totalInscricoes: minhasInscricoes.length,
    inscricoes: minhasInscricoes,
    eventosAbertos: eventosAbertos || [],
  });
}
