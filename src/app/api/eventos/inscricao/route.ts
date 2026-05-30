import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  createOrFindAsaasCustomer,
  createEventoPayment,
} from '@/lib/asaas';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import { parseCampoMissionarioConfig } from '@/lib/ago-regras';

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
      // AGO Campo Missionário — esposa
      incluir_esposa,
      esposa,
      // Campos hospedagem AGO
      hosp_necessidade_especial,
      hosp_descricao_necessidade,
      hosp_cama_inferior,
      hosp_observacoes,
      grupo_hospedagem,
    } = body;

    if (!slug || !nome_inscrito?.trim() || !supervisao_id) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
    }

    const supabase = createServerClient();

    // ── Busca evento ──────────────────────────────────────────
    const { data: evento, error: evErr } = await supabase
      .from('eventos')
      .select('id, nome, valor_inscricao, usar_tipos_inscricao, inscricoes_abertas, limite_vagas, limite_hospedagem, limite_brindes, status, departamento, configuracoes_ago')
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

    // ── Snapshot ministerial (AGO) — não bloqueia se não encontrar ──────
    const cpfLimpo = cpf?.replace(/\D/g, '') || null;
    let ministroSnapshot: Record<string, unknown> | null = null;
    if (cpfLimpo && evento.departamento === 'AGO') {
      const { data: membro } = await supabase
        .from('members')
        .select('id, name, cpf, matricula, data_nascimento, campo_id, supervisao_id, status, cargo_ministerial, pastor_presidente, pastor_auxiliar, jubilado')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (membro) {
        // Verifica se o campo do membro é missionário
        let isCampoMissionario = false;
        let campoNome: string | null = null;
        let supervisaoNome: string | null = null;
        if (membro.campo_id) {
          const { data: campoData } = await supabase
            .from('campos')
            .select('nome, is_campo_missionario, supervisao_id')
            .eq('id', membro.campo_id)
            .maybeSingle();
          if (campoData) {
            isCampoMissionario = !!campoData.is_campo_missionario;
            campoNome = campoData.nome ?? campoNome;
          }
        }

        // Aplica desconto Campo Missionário se aplicável
        const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
        const descontoHabilitado = !!(confAgo?.habilitar_desconto_campo_missionario);
        const isPastorPresidente = !!(membro as any).pastor_presidente;
        const ehPastorPresidentePorTipo = tipoNome ? /pastor\s*presidente/i.test(tipoNome) : false;
        if (descontoHabilitado && isCampoMissionario && (isPastorPresidente || ehPastorPresidentePorTipo)) {
          const cmConfig = parseCampoMissionarioConfig(confAgo);
          const valorEspecial = cmConfig
            ? (typeof cmConfig.valor_pastor_presidente === 'number' ? cmConfig.valor_pastor_presidente : parseFloat(String(cmConfig.valor_pastor_presidente)) || 0)
            : parseFloat(String(confAgo?.valor_pastor_presidente_campo_missionario ?? '0')) || 0;
          if (valorEspecial > 0 && valorEspecial < valorBase) {
            valorBase = valorEspecial;
            valorFinal = valorBase - desconto > 0 ? valorBase - desconto : 0;
          }
        }

        ministroSnapshot = {
          ministro_id: membro.id, nome: membro.name, cpf: membro.cpf,
          matricula: membro.matricula ?? null,
          data_nascimento: membro.data_nascimento ?? null,
          campo: campoNome, campo_id: membro.campo_id ?? null,
          supervisao: supervisaoNome, supervisao_id: membro.supervisao_id ?? null,
          status_ministerial: (membro as any).status ?? null,
          cargo: (membro as any).cargo_ministerial ?? null,
          is_pastor_presidente: !!((membro as any).pastor_presidente),
          is_pastor_auxiliar: !!((membro as any).pastor_auxiliar),
          is_pastor_jubilado: !!((membro as any).jubilado),
          is_campo_missionario: isCampoMissionario,
        };
      }
    }

    // ════════════════════════════════════════════════════════════
    // FLUXO AGO CAMPO MISSIONÁRIO — ESPOSA (2 inscrições, 1 cobrança)
    // ════════════════════════════════════════════════════════════
    const ehEsposaFlow = !!(incluir_esposa) && !!(esposa) && evento.departamento === 'AGO';
    if (ehEsposaFlow) {
      // Busca valor da esposa a partir da config
      const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
      const cmConfig = parseCampoMissionarioConfig(confAgo);
      const valorEsposaBase = cmConfig
        ? (typeof cmConfig.valor_esposa === 'number' ? cmConfig.valor_esposa : parseFloat(String(cmConfig.valor_esposa)) || 0)
        : 0;

      // Busca tipo "Esposa de Pastor Presidente" para inclui_alimentacao
      const { data: tipoEsposa } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, inclui_hospedagem')
        .eq('evento_id', evento.id)
        .ilike('nome', 'Esposa de Pastor Presidente')
        .eq('ativo', true)
        .maybeSingle();

      const valorTotal2 = valorFinal + valorEsposaBase;
      const codigoLote2 = gerarCodigoLote();
      const isGratuito2 = valorTotal2 <= 0;

      const lotePayload2 = normalizePayloadUppercase({
        evento_id:            evento.id,
        codigo:               codigoLote2,
        responsavel_nome:     nome_inscrito.trim(),
        responsavel_email:    email?.trim() || null,
        responsavel_whatsapp: whatsapp?.trim() || null,
        valor_total:          valorTotal2,
        status_pagamento:     isGratuito2 ? 'isento' : 'pendente',
        cupom_codigo:         cupomUsado,
        desconto_valor:       desconto,
      });

      const { data: lote2, error: loteErr2 } = await supabase
        .from('evento_lotes_inscricao')
        .insert([lotePayload2])
        .select('id')
        .single();

      if (loteErr2 || !lote2) return NextResponse.json({ error: 'Erro ao criar lote do casal' }, { status: 500 });

      // Cria as 2 inscrições (pastor + esposa)
      const rowPastor = normalizePayloadUppercase({
        evento_id:        evento.id,
        lote_id:          lote2.id,
        nome_inscrito:    nome_inscrito.trim(),
        cpf:              cpf?.replace(/\D/g, '') || null,
        email:            email?.trim() || null,
        whatsapp:         whatsapp?.trim() || null,
        sexo:             sexo || null,
        data_nascimento:  data_nascimento || null,
        supervisao_id:    supervisao_id || null,
        campo_id:         campo_id || null,
        hospedagem:       !!hospedagem,
        alimentacao:      tipoInclui.alimentacao,
        brinde:           !!brinde,
        tipo_inscricao:   tipoNome,
        valor_original:   valorBase,
        cupom_codigo:     cupomUsado,
        desconto_valor:   desconto,
        valor_final:      valorFinal,
        valor_pago:       valorFinal,
        status_pagamento: isGratuito2 ? 'isento' : 'pendente',
        qr_code:          qr_code || null,
        ministro_snapshot: ministroSnapshot,
        hosp_necessidade_especial:  !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
        hosp_cama_inferior:         !!hosp_cama_inferior,
        hosp_observacoes:           hosp_observacoes?.trim() || null,
        hosp_possui_comorbidade:    !!(body as any).hosp_possui_comorbidade,
        hosp_descricao_comorbidade: ((body as any).hosp_descricao_comorbidade as string)?.trim() || null,
        grupo_hospedagem:           (grupo_hospedagem as string)?.trim() || null,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      });

      const esposaData = esposa as Record<string, unknown>;
      const rowEsposa = normalizePayloadUppercase({
        evento_id:        evento.id,
        lote_id:          lote2.id,
        nome_inscrito:    String(esposaData.nome_inscrito ?? '').trim(),
        cpf:              String(esposaData.cpf ?? '').replace(/\D/g, '') || null,
        whatsapp:         String(esposaData.whatsapp ?? '').trim() || null,
        sexo:             'F',
        data_nascimento:  esposaData.data_nascimento || null,
        supervisao_id:    supervisao_id || null,
        campo_id:         campo_id || null,
        hospedagem:       !!esposaData.hospedagem,
        alimentacao:      !!(tipoEsposa?.inclui_alimentacao),
        brinde:           false,
        tipo_inscricao:   'Esposa de Pastor Presidente',
        valor_original:   valorEsposaBase,
        cupom_codigo:     null,
        desconto_valor:   0,
        valor_final:      valorEsposaBase,
        valor_pago:       valorEsposaBase,
        status_pagamento: isGratuito2 ? 'isento' : 'pendente',
        qr_code:          esposaData.qr_code || null,
        hosp_necessidade_especial:  !!esposaData.hosp_necessidade_especial,
        hosp_descricao_necessidade: String(esposaData.hosp_descricao_necessidade ?? '').trim() || null,
        hosp_cama_inferior:         !!esposaData.hosp_cama_inferior,
        hosp_observacoes:           String(esposaData.hosp_observacoes ?? '').trim() || null,
        hosp_possui_comorbidade:    !!esposaData.hosp_possui_comorbidade,
        hosp_descricao_comorbidade: String(esposaData.hosp_descricao_comorbidade ?? '').trim() || null,
        grupo_hospedagem:           String(esposaData.grupo_hospedagem ?? '').trim() || null,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      });

      const { data: insRows, error: insErr2 } = await supabase
        .from('evento_inscricoes')
        .insert([rowPastor, rowEsposa])
        .select('id');

      if (insErr2 || !insRows || insRows.length < 2) {
        return NextResponse.json({ error: 'Erro ao inserir inscrições do casal' }, { status: 500 });
      }

      const [insPastor, insEsposa] = insRows;

      // Cria registros de hospedagem AGO se solicitados
      if (evento.departamento === 'AGO') {
        const { calcularPrioridadeHospedagem } = await import('@/lib/hospedagem-helpers');
        if (!!hospedagem) {
          const priorPastor = calcularPrioridadeHospedagem({ id: insPastor.id, nome_inscrito: nome_inscrito.trim(), sexo: sexo || null, data_nascimento: data_nascimento || null, tipo_inscricao: tipoNome, hosp_necessidade_especial: !!hosp_necessidade_especial, hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null, hosp_cama_inferior: !!hosp_cama_inferior, hosp_observacoes: hosp_observacoes?.trim() || null });
          await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: evento.id, inscricao_id: insPastor.id, status: 'solicitada', prioridade: priorPastor, necessidade_especial: !!hosp_necessidade_especial, descricao_necessidade: hosp_descricao_necessidade?.trim() || null, cama_inferior: !!hosp_cama_inferior, observacoes: hosp_observacoes?.trim() || null, grupo_hospedagem: (grupo_hospedagem as string)?.trim() || null, alocacao_automatica: true })]);
        }
        if (!!esposaData.hospedagem) {
          const priorEsposa = calcularPrioridadeHospedagem({ id: insEsposa.id, nome_inscrito: String(esposaData.nome_inscrito ?? ''), sexo: 'F', data_nascimento: esposaData.data_nascimento as string | null, tipo_inscricao: 'Esposa de Pastor Presidente', hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial, hosp_descricao_necessidade: String(esposaData.hosp_descricao_necessidade ?? '').trim() || null, hosp_cama_inferior: !!esposaData.hosp_cama_inferior, hosp_observacoes: String(esposaData.hosp_observacoes ?? '').trim() || null });
          await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: evento.id, inscricao_id: insEsposa.id, status: 'solicitada', prioridade: priorEsposa, necessidade_especial: !!esposaData.hosp_necessidade_especial, descricao_necessidade: String(esposaData.hosp_descricao_necessidade ?? '').trim() || null, cama_inferior: !!esposaData.hosp_cama_inferior, observacoes: String(esposaData.hosp_observacoes ?? '').trim() || null, grupo_hospedagem: String(esposaData.grupo_hospedagem ?? '').trim() || null, alocacao_automatica: true })]);
        }
      }

      if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado);

      if (isGratuito2) {
        return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, statusPagamento: 'isento', pagamento: null });
      }

      try {
        const customerId2 = await createOrFindAsaasCustomer({ nome: nome_inscrito.trim(), email: email?.trim() || null, cpf: cleanCpf(cpf), whatsapp: whatsapp || null });
        const dueDate2 = dueDateFromNow();
        const pagamento2 = await createEventoPayment({ customerId: customerId2, value: valorTotal2, dueDate: dueDate2, description: `Inscrição Casal CM — ${evento.nome}`, externalReference: `lote:${lote2.id}` });
        await supabase.from('evento_lotes_inscricao').update({ asaas_payment_id: pagamento2.id, invoice_url: pagamento2.invoiceUrl, pix_copia_cola: pagamento2.pixCopiaECola, pix_qr_code: pagamento2.pixQrCode, asaas_due_date: dueDate2 }).eq('id', lote2.id);
        return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, statusPagamento: 'pendente', pagamento: { asaasId: pagamento2.id, invoiceUrl: pagamento2.invoiceUrl, pixQrCode: pagamento2.pixQrCode, pixCopiaECola: pagamento2.pixCopiaECola, valor: valorTotal2, vencimento: dueDate2 } });
      } catch (asaasErr) {
        console.error('[INSCRICAO CASAL] ASAAS falhou:', (asaasErr as Error).message);
        return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, statusPagamento: 'pendente', pagamento: null, asaasError: 'Pagamento online indisponível.' });
      }
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
      ministro_snapshot: ministroSnapshot,
      // Campos hospedagem AGO
      hosp_necessidade_especial:  !!hosp_necessidade_especial,
      hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
      hosp_cama_inferior:         !!hosp_cama_inferior,
      hosp_observacoes:           hosp_observacoes?.trim() || null,
      hosp_possui_comorbidade:    !!(body as any).hosp_possui_comorbidade,
      hosp_descricao_comorbidade: ((body as any).hosp_descricao_comorbidade as string)?.trim() || null,
      grupo_hospedagem:           (grupo_hospedagem as string)?.trim() || null,
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
        grupo_hospedagem:     (grupo_hospedagem as string)?.trim() || null,
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
