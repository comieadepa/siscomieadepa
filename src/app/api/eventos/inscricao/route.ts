import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  createOrFindAsaasCustomer,
  createEventoPayment,
} from '@/lib/asaas';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import { cleanCpf, isValidCpf } from '@/lib/cpf';

const VENCIMENTO_DIAS = 3;

function dueDateFromNow(dias = VENCIMENTO_DIAS): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function gerarCodigoLote(): string {
  return 'LOTE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// Valida e retorna desconto de cupom (sem incrementar usados ainda)
async function calcularDesconto(
  supabase: ReturnType<typeof createServerClient>,
  eventoId: string,
  codigo: string,
  valorBase: number
): Promise<{ desconto: number; valorFinal: number; cupomId: string } | null> {
  const { data: cupom } = await supabase
    .from('evento_cupons')
    .select('id, tipo, valor, limite_uso, usados, validade')
    .eq('evento_id', eventoId)
    .eq('codigo', codigo.trim().toUpperCase())
    .eq('ativo', true)
    .single();

  if (!cupom) return null;
  if (cupom.validade && new Date(cupom.validade) < new Date()) return null;
  if (cupom.limite_uso !== null && cupom.usados >= cupom.limite_uso) return null;

  const desconto = cupom.tipo === 'percentual'
    ? Math.round(valorBase * cupom.valor / 100 * 100) / 100
    : Math.min(cupom.valor, valorBase);

  return { desconto, valorFinal: Math.max(0, valorBase - desconto), cupomId: cupom.id };
}

// Incrementa usados do cupom via UPDATE direto (sem RPC)
async function incrementarCupom(
  supabase: ReturnType<typeof createServerClient>,
  eventoId: string,
  codigo: string,
  qtd = 1
) {
  // Lê o valor atual e incrementa (race condition aceitável para o volume esperado)
  const { data: cup } = await supabase
    .from('evento_cupons')
    .select('usados')
    .eq('evento_id', eventoId)
    .eq('codigo', codigo)
    .single();
  if (cup) {
    await supabase
      .from('evento_cupons')
      .update({ usados: cup.usados + qtd })
      .eq('evento_id', eventoId)
      .eq('codigo', codigo);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      slug,
      nome_inscrito,
      cpf,
      email,
      telefone,
      whatsapp,
      sexo,
      data_nascimento,
      supervisao_id,
      campo_id,
      hospedagem,
      alimentacao,
      brinde,
      qr_code,
      // Novos campos
      tipo_inscricao,
      cupom_codigo,
      participantes, // Array → inscrição em lote
      // Campos hospedagem AGO
      hosp_necessidade_especial,
      hosp_descricao_necessidade,
      hosp_cama_inferior,
      hosp_observacoes,
    } = body;

    if (!slug || !nome_inscrito?.trim() || !supervisao_id) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const supabase = createServerClient();

    // ── Busca evento ──────────────────────────────────────────
    const { data: evento, error: evErr } = await supabase
      .from('eventos')
      .select('id, nome, valor_inscricao, usar_tipos_inscricao, inscricoes_abertas, limite_vagas, limite_hospedagem, limite_brindes, status, departamento')
      .eq('slug', slug)
      .single();

    if (evErr || !evento) {
      return NextResponse.json({ error: 'Evento não encontrado' }, { status: 404 });
    }

    if (!evento.inscricoes_abertas || evento.status !== 'programado') {
      return NextResponse.json({ error: 'Inscrições encerradas' }, { status: 409 });
    }

    // ── Valida uso de tipos de inscrição ─────────────────────────────────
    const usaTipos = !!(evento as Record<string, unknown>).usar_tipos_inscricao;
    if (usaTipos && !tipo_inscricao) {
      return NextResponse.json({ error: 'Selecione uma modalidade de inscrição.' }, { status: 400 });
    }

    // ── Busca tipo de inscrição (se informado) ────────────────────────
    let valorBase  = evento.valor_inscricao ?? 0;
    let tipoNome   = usaTipos ? ((tipo_inscricao as string | null) ?? null) : null;
    let tipoInclui = { alimentacao: !!alimentacao, hospedagem: !!hospedagem };
    let tipoRefeicoes = 0;

    if (tipo_inscricao && usaTipos) {
      const { data: tipo } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, valor, inclui_alimentacao, inclui_hospedagem, quantidade_refeicoes')
        .eq('evento_id', evento.id)
        .ilike('nome', String(tipo_inscricao).trim())
        .eq('ativo', true)
        .single();
      if (tipo) {
        valorBase  = tipo.valor;
        tipoNome   = tipo.nome;
        tipoInclui = { alimentacao: tipo.inclui_alimentacao, hospedagem: tipo.inclui_hospedagem };
        tipoRefeicoes = (tipo.inclui_alimentacao && tipo.quantidade_refeicoes > 0)
          ? tipo.quantidade_refeicoes
          : 0;
      }
    }

    // ── Aplica cupom ──────────────────────────────────────────
    let desconto   = 0;
    let valorFinal = valorBase;
    let cupomUsado = null as string | null;

    if (cupom_codigo) {
      const result = await calcularDesconto(supabase, evento.id, cupom_codigo, valorBase);
      if (result) {
        desconto   = result.desconto;
        valorFinal = result.valorFinal;
        cupomUsado = String(cupom_codigo).trim().toUpperCase();
      }
    }

    // ── Verifica vagas gerais ─────────────────────────────────
    const ehLote   = Array.isArray(participantes) && participantes.length > 0;
    const qtdTotal = ehLote ? 1 + participantes.length : 1;

    if (evento.limite_vagas) {
      const { count } = await supabase
        .from('evento_inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', evento.id);
      if ((count ?? 0) + qtdTotal > evento.limite_vagas) {
        return NextResponse.json({ error: 'Vagas insuficientes' }, { status: 409 });
      }
    }

    // ── Verifica vagas de hospedagem ──────────────────────────
    const querHospedagem = tipoInclui.hospedagem || !!hospedagem;
    // Para lote: conta todos os participantes que terão hospedagem
    const qtdComHospedagem = ehLote
      ? (querHospedagem ? 1 : 0) + (Array.isArray(participantes) ? (participantes as { hospedagem?: boolean }[]).filter(p => tipoInclui.hospedagem || !!p.hospedagem).length : 0)
      : (querHospedagem ? 1 : 0);

    if (qtdComHospedagem > 0 && evento.limite_hospedagem) {
      const { count: hospCount } = await supabase
        .from('evento_inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', evento.id)
        .eq('hospedagem', true);
      if ((hospCount ?? 0) + qtdComHospedagem > evento.limite_hospedagem) {
        return NextResponse.json({ error: 'Vagas de hospedagem insuficientes' }, { status: 409 });
      }
    }

    const isGratuito = valorFinal <= 0;

    if (!isGratuito && !isValidCpf(cpf)) {
      return NextResponse.json({
        error: 'CPF invalido. Confira o CPF do responsavel para gerar o pagamento online.',
      }, { status: 400 });
    }

    // ════════════════════════════════════════════════════════════
    // FLUXO LOTE
    // ════════════════════════════════════════════════════════════
    if (ehLote) {
      const todos = [
        { nome_inscrito, cpf, email, telefone, whatsapp, sexo, data_nascimento, supervisao_id, campo_id, hospedagem: querHospedagem, alimentacao: tipoInclui.alimentacao, brinde: !!brinde, qr_code },
        ...participantes,
      ];
      const valorTotalLote = valorFinal * todos.length;
      const codigoLote     = gerarCodigoLote();

      const lotePayload = normalizePayloadUppercase({
        evento_id:            evento.id,
        codigo:               codigoLote,
        responsavel_nome:     nome_inscrito.trim(),
        responsavel_email:    email?.trim() || null,
        responsavel_whatsapp: whatsapp?.trim() || null,
        valor_total:          valorTotalLote,
        status_pagamento:     isGratuito ? 'isento' : 'pendente',
        cupom_codigo:         cupomUsado,
        desconto_valor:       desconto * todos.length,
      });

      const { data: lote, error: loteErr } = await supabase
        .from('evento_lotes_inscricao')
        .insert([lotePayload])
        .select('id')
        .single();

      if (loteErr || !lote) return NextResponse.json({ error: 'Erro ao criar lote' }, { status: 500 });

      const rows = todos.map(p => normalizePayloadUppercase({
        evento_id:        evento.id,
        lote_id:          lote.id,
        nome_inscrito:    String(p.nome_inscrito ?? nome_inscrito).trim(),
        cpf:              p.cpf?.replace?.(/\D/g, '') || null,
        email:            p.email?.trim() || null,
        telefone:         p.telefone?.trim() || null,
        whatsapp:         p.whatsapp?.trim() || null,
        sexo:             p.sexo || null,
        data_nascimento:  p.data_nascimento || null,
        supervisao_id:    p.supervisao_id || supervisao_id,
        campo_id:         p.campo_id || campo_id || null,
        hospedagem:       !!p.hospedagem,
        alimentacao:      !!p.alimentacao,
        brinde:           !!p.brinde,
        tipo_inscricao:   tipoNome,
        valor_original:   valorBase,
        cupom_codigo:     cupomUsado,
        desconto_valor:   desconto,
        valor_final:      valorFinal,
        valor_pago:       valorFinal,
        status_pagamento: isGratuito ? 'isento' : 'pendente',
        qr_code:          p.qr_code || null,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      }));

      const { error: insRowsErr } = await supabase.from('evento_inscricoes').insert(rows);
      if (insRowsErr) return NextResponse.json({ error: 'Erro ao inserir inscrições do lote' }, { status: 500 });

      if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado, todos.length);

      if (isGratuito) {
        return NextResponse.json({ loteId: lote.id, inscricoes: todos.length, statusPagamento: 'isento', pagamento: null });
      }

      try {
        const customerId = await createOrFindAsaasCustomer({ nome: nome_inscrito.trim(), email: email?.trim() || null, cpf: cleanCpf(cpf), whatsapp: whatsapp || null });
        const dueDateLote = dueDateFromNow();
        const pagamento  = await createEventoPayment({ customerId, value: valorTotalLote, dueDate: dueDateLote, description: `Lote ${codigoLote} — ${evento.nome} (${todos.length} insc.)`, externalReference: `lote:${lote.id}` });
        await supabase.from('evento_lotes_inscricao').update({
          asaas_payment_id: pagamento.id,
          invoice_url:      pagamento.invoiceUrl,
          pix_copia_cola:   pagamento.pixCopiaECola,
          pix_qr_code:      pagamento.pixQrCode,
          asaas_due_date:   dueDateLote,
        }).eq('id', lote.id);
        return NextResponse.json({ loteId: lote.id, inscricoes: todos.length, statusPagamento: 'pendente', pagamento: { asaasId: pagamento.id, invoiceUrl: pagamento.invoiceUrl, pixQrCode: pagamento.pixQrCode, pixCopiaECola: pagamento.pixCopiaECola, valor: valorTotalLote, vencimento: dueDateLote } });
      } catch (asaasErr) {
        const message = asaasErr instanceof Error ? asaasErr.message : String(asaasErr);
        console.error('[INSCRICAO LOTE] ASAAS falhou, lote salvo sem cobranca:', {
          loteId: lote.id,
          eventoId: evento.id,
          valor: valorTotalLote,
          erro: message,
        });
        return NextResponse.json({ loteId: lote.id, inscricoes: todos.length, statusPagamento: 'pendente', pagamento: null, asaasError: 'Pagamento online indisponível.' });
      }
    }

    // ════════════════════════════════════════════════════════════
    // FLUXO INDIVIDUAL
    // ════════════════════════════════════════════════════════════
    const inscricaoPayload = normalizePayloadUppercase({
      evento_id:        evento.id,
      nome_inscrito:    nome_inscrito.trim(),
      cpf:              cpf?.replace(/\D/g, '') || null,
      email:            email?.trim() || null,
      telefone:         telefone?.trim() || null,
      whatsapp:         whatsapp?.trim() || null,
      sexo:             sexo || null,
      data_nascimento:  data_nascimento || null,
      supervisao_id:    supervisao_id || null,
      campo_id:         campo_id || null,
      hospedagem:       querHospedagem,
      alimentacao:      tipoInclui.alimentacao,
      brinde:           !!brinde,
      tipo_inscricao:   tipoNome,
      valor_original:   valorBase,
      cupom_codigo:     cupomUsado,
      desconto_valor:   desconto,
      valor_final:      valorFinal,
      valor_pago:       valorFinal,
      status_pagamento: isGratuito ? 'isento' : 'pendente',
      forma_pagamento:  isGratuito ? null : 'pix',
      qr_code:          qr_code || null,
      refeicoes_total:  tipoInclui.alimentacao ? tipoRefeicoes : 0,
      // Campos hospedagem AGO
      hosp_necessidade_especial:  !!hosp_necessidade_especial,
      hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
      hosp_cama_inferior:         !!hosp_cama_inferior,
      hosp_observacoes:           hosp_observacoes?.trim() || null,
      lgpd_aceito:      true,
      lgpd_aceito_em:   new Date().toISOString(),
    });

    const { data: inscricao, error: insErr } = await supabase
      .from('evento_inscricoes')
      .insert([inscricaoPayload])
      .select('id')
      .single();

    if (insErr || !inscricao) {
      console.error('[INSCRICAO] Erro ao inserir:', insErr);
      return NextResponse.json({ error: 'Erro ao salvar inscrição' }, { status: 500 });
    }

    if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado);

    // Cria registro de hospedagem AGO se evento AGO com hospedagem
    if (querHospedagem && evento.departamento === 'AGO') {
      const { calcularPrioridadeHospedagem } = await import('@/lib/hospedagem-helpers');
      const prioridade = calcularPrioridadeHospedagem({
        id: inscricao.id,
        nome_inscrito: nome_inscrito.trim(),
        sexo: sexo || null,
        data_nascimento: data_nascimento || null,
        tipo_inscricao: tipoNome,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
        hosp_cama_inferior: !!hosp_cama_inferior,
        hosp_observacoes: hosp_observacoes?.trim() || null,
      });
      const hospedagemPayload = normalizePayloadUppercase({
        evento_id:            evento.id,
        inscricao_id:         inscricao.id,
        status:               'solicitada',
        prioridade,
        necessidade_especial: !!hosp_necessidade_especial,
        descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
        cama_inferior:        !!hosp_cama_inferior,
        observacoes:          hosp_observacoes?.trim() || null,
        alocacao_automatica:  true,
      });
      await supabase.from('evento_hospedagens').insert([hospedagemPayload]);
    }

    if (isGratuito) {
      void logDB({
        userEmail: email?.trim() ?? undefined,
        acao: 'criar',
        modulo: 'publico',
        entidade: 'evento_inscricoes',
        entidadeId: inscricao.id,
        descricao: `[Público] Nova inscrição: ${nome_inscrito} — ${evento.nome}`,
        request,
      })
      return NextResponse.json({ inscricaoId: inscricao.id, statusPagamento: 'isento', pagamento: null });
    }

    // Cria cobrança ASAAS
    try {
      const customerId = await createOrFindAsaasCustomer({
        nome:     nome_inscrito.trim(),
        email:    email?.trim() || null,
        cpf:      cleanCpf(cpf),
        whatsapp: whatsapp || null,
      });

      const pagamento = await createEventoPayment({
        customerId,
        value:             valorFinal,
        dueDate:           dueDateFromNow(),
        description:       `Inscrição — ${evento.nome}${tipoNome ? ` (${tipoNome})` : ''}`,
        externalReference: inscricao.id,
      });

      // Salva dados ASAAS na inscrição
      const dueDate = dueDateFromNow();
      await supabase
        .from('evento_inscricoes')
        .update({
          asaas_payment_id: pagamento.id,
          forma_pagamento:  'pix',
          invoice_url:      pagamento.invoiceUrl,
          pix_copia_cola:   pagamento.pixCopiaECola,
          pix_qr_code:      pagamento.pixQrCode,
          asaas_due_date:   dueDate,
        })
        .eq('id', inscricao.id);

      void logDB({
        userEmail: email?.trim() ?? undefined,
        acao: 'criar',
        modulo: 'publico',
        entidade: 'evento_inscricoes',
        entidadeId: inscricao.id,
        descricao: `[Público] Nova inscrição (pago): ${nome_inscrito} — ${evento.nome}`,
        request,
      })

      return NextResponse.json({
        inscricaoId:     inscricao.id,
        statusPagamento: 'pendente',
        pagamento: {
          asaasId:      pagamento.id,
          invoiceUrl:   pagamento.invoiceUrl,
          pixQrCode:    pagamento.pixQrCode,
          pixCopiaECola:pagamento.pixCopiaECola,
          valor:        valorFinal,
          vencimento:   dueDate,
        },
      });
    } catch (asaasErr) {
      // ASAAS falhou mas inscrição já foi criada — retorna sem dados de pagamento
      // O operador pode fazer baixa manual depois
      console.error('[INSCRICAO] ASAAS falhou, inscrição salva sem cobrança:', (asaasErr as Error).message);
      return NextResponse.json({
        inscricaoId:     inscricao.id,
        statusPagamento: 'pendente',
        pagamento:       null,
        asaasError:      'Pagamento online indisponível no momento. Regularize com a organização do evento.',
      });
    }
  } catch (err: any) {
    console.error('[INSCRICAO] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
