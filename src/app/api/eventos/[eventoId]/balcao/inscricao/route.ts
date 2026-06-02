import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import {
  calcularPrioridadeHospedagem,
  resolveCamaInferiorAutomatica,
  resolveGrupoHospedagemAGO,
} from '@/lib/hospedagem-helpers';
import { createOrFindAsaasCustomer, createEventoPayment } from '@/lib/asaas';
import { cleanCpf } from '@/lib/cpf';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { parseCampoMissionarioConfig } from '@/lib/ago-regras';

const VENCIMENTO_DIAS = 3;

function dueDateFromNow(dias = VENCIMENTO_DIAS): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function incrementarCupom(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase-server').createServerClient>>,
  eventoId: string,
  codigo: string
) {
  const { data: cup } = await supabase
    .from('evento_cupons')
    .select('usados')
    .eq('evento_id', eventoId)
    .eq('codigo', codigo)
    .single();
  if (cup) {
    await supabase
      .from('evento_cupons')
      .update({ usados: cup.usados + 1 })
      .eq('evento_id', eventoId)
      .eq('codigo', codigo);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const operadorId = guard.ctx.user?.id;
  const operadorEmail = guard.ctx.user?.email ?? undefined;

  try {
    const body = await request.json() as Record<string, unknown>;
    const {
      nome_inscrito,
      cpf,
      email,
      whatsapp,
      sexo,
      data_nascimento,
      supervisao_id,
      campo_id,
      hospedagem,
      brinde,
      tipo_inscricao,
      cupom_codigo,
      valor_original,
      desconto_valor,
      valor_final,
      forma_pagamento,
      observacoes,
      qr_code,
      hosp_necessidade_especial,
      hosp_descricao_necessidade,
      hosp_observacoes,
      incluir_esposa,
      esposa,
    } = body;

    const hospPossuiComorbidade = !!(body as any).hosp_possui_comorbidade;
    const hospDescricaoComorbidade = ((body as any).hosp_descricao_comorbidade as string)?.trim() || null;
    let hospCamaInferiorAuto = false;
    let grupoHospedagemAuto: string | null = null;

    if (!nome_inscrito || !String(nome_inscrito).trim() || !supervisao_id) {
      return NextResponse.json({ error: 'Nome e Supervisão são obrigatórios.' }, { status: 400 });
    }

    // Busca dados completos do evento
    const { data: evento } = await supabase
      .from('eventos')
      .select('id,nome,slug,departamento,configuracoes_ago,inscricoes_abertas,status')
      .eq('id', eventoId)
      .single();

    if (!evento) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    let tipoNome = tipo_inscricao ? String(tipo_inscricao).trim() : null;
    let incluiAlimentacao = false;
    let quantidadeRefeicoes = 0;
    if (tipoNome) {
      const { data: tipo } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .ilike('nome', tipoNome)
        .eq('ativo', true)
        .maybeSingle();
      if (tipo) {
        tipoNome = tipo.nome;
        incluiAlimentacao = !!tipo.inclui_alimentacao;
        quantidadeRefeicoes = incluiAlimentacao ? Math.max(0, Number(tipo.quantidade_refeicoes ?? 0)) : 0;
      }
    }

    if ((evento as any).departamento === 'AGO') {
      hospCamaInferiorAuto = resolveCamaInferiorAutomatica({
        sexo: sexo ? String(sexo) : null,
        data_nascimento: data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao: tipoNome,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_possui_comorbidade: hospPossuiComorbidade,
      });
      grupoHospedagemAuto = resolveGrupoHospedagemAGO({
        sexo: sexo ? String(sexo) : null,
        data_nascimento: data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao: tipoNome,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_possui_comorbidade: hospPossuiComorbidade,
      });
    }

    // Determina forma e status de pagamento
    const formaStr = String(forma_pagamento ?? '');
    const vFinal = typeof valor_final === 'number' ? valor_final : 0;
    const vOriginal = typeof valor_original === 'number' ? valor_original : 0;
    const vDesconto = typeof desconto_valor === 'number' ? desconto_valor : 0;
    const isGratuito = vFinal <= 0 || formaStr === 'isento';
    const isAsaas = formaStr === 'asaas' && !isGratuito;
    const isPresencial = !isAsaas && !isGratuito;

    const statusPag = isGratuito ? 'isento'
      : isAsaas ? 'pendente'
      : 'pago';

    const formaPagSalva = isGratuito ? null
      : formaStr === 'pix_manual' ? 'pix'
      : formaStr === 'asaas' ? 'pix'   // sobrescrito após criação ASAAS
      : formaStr;

    // CPF limpo
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;

    // Snapshot ministerial (AGO)
    let ministroSnapshot: Record<string, unknown> | null = null;
    if (cpfLimpo && (evento as any).departamento === 'AGO') {
      const { data: membro } = await supabase
        .from('members')
        .select('id,name,cpf,matricula,data_nascimento,campo_id,supervisao_id,status,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (membro) {
        let isCampoMissionario = false;
        let campoNome: string | null = null;
        if ((membro as any).campo_id) {
          const { data: campoData } = await supabase
            .from('campos')
            .select('nome,is_campo_missionario')
            .eq('id', (membro as any).campo_id)
            .maybeSingle();
          if (campoData) {
            isCampoMissionario = !!(campoData as any).is_campo_missionario;
            campoNome = (campoData as any).nome ?? null;
          }
        }
        ministroSnapshot = {
          ministro_id:        (membro as any).id,
          nome:               (membro as any).name,
          cpf:                (membro as any).cpf,
          matricula:          (membro as any).matricula ?? null,
          campo:              campoNome,
          campo_id:           (membro as any).campo_id ?? null,
          supervisao_id:      (membro as any).supervisao_id ?? null,
          status_ministerial: (membro as any).status ?? null,
          cargo:              (membro as any).cargo_ministerial ?? null,
          is_pastor_presidente:  !!((membro as any).pastor_presidente),
          is_pastor_auxiliar:    !!((membro as any).pastor_auxiliar),
          is_pastor_jubilado:    !!((membro as any).jubilado),
          is_campo_missionario:  isCampoMissionario,
        };
      }
    }

    // QR code
    const qrFinal = qr_code ? String(qr_code) : generateQRCodeToken();
    const cupomCodigo = cupom_codigo
      ? String(cupom_codigo).trim().toUpperCase()
      : null;

    // ── Fluxo esposa (AGO Campo Missionário) ─────────────────
    const ehEsposaFlow = !!(incluir_esposa) && !!(esposa) && (evento as any).departamento === 'AGO';
    if (ehEsposaFlow) {
      const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
      const cmConfig = parseCampoMissionarioConfig(confAgo);
      const valorEsposaBase = cmConfig
        ? (typeof cmConfig.valor_esposa === 'number' ? cmConfig.valor_esposa : parseFloat(String(cmConfig.valor_esposa)) || 0)
        : 0;

      // Consulta tipo "Esposa de Pastor Presidente*" para nome e alimentação
      const { data: tipoEsposa } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .ilike('nome', 'Esposa de Pastor Presidente%')
        .eq('ativo', true)
        .maybeSingle();

      const refeicoesEsposa = tipoEsposa?.inclui_alimentacao
        ? Math.max(0, Number(tipoEsposa?.quantidade_refeicoes ?? 0))
        : 0;

      const esposaData = esposa as Record<string, unknown>;
      const esposaComorbidade = !!esposaData.hosp_possui_comorbidade;
      const esposaCamaInferiorAuto = resolveCamaInferiorAutomatica({
        sexo: 'F',
        data_nascimento: esposaData.data_nascimento ? String(esposaData.data_nascimento) : null,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_possui_comorbidade: esposaComorbidade,
      });
      const esposaGrupoAuto = resolveGrupoHospedagemAGO({
        sexo: 'F',
        data_nascimento: esposaData.data_nascimento ? String(esposaData.data_nascimento) : null,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_possui_comorbidade: esposaComorbidade,
      });
      const valorTotal2 = vFinal + valorEsposaBase;
      const isGratuito2 = valorTotal2 <= 0 || formaStr === 'isento';
      const codigoLote2 = 'LOTE-' + Date.now().toString(36).toUpperCase() + '-B';

      const { data: lote2, error: loteErr2 } = await supabase
        .from('evento_lotes_inscricao')
        .insert([normalizePayloadUppercase({
          evento_id:            eventoId,
          codigo:               codigoLote2,
          responsavel_nome:     String(nome_inscrito).trim(),
          responsavel_email:    email ? String(email).trim() : null,
          responsavel_whatsapp: whatsapp ? String(whatsapp).trim() : null,
          valor_total:          valorTotal2,
          status_pagamento:     isGratuito2 ? 'isento' : isPresencial ? 'pago' : 'pendente',
          cupom_codigo:         cupomCodigo,
          desconto_valor:       vDesconto,
        })])
        .select('id')
        .single();

      if (loteErr2 || !lote2) return NextResponse.json({ error: 'Erro ao criar lote casal.' }, { status: 500 });

      const rowPastor = normalizePayloadUppercase({
        evento_id: eventoId, lote_id: lote2.id,
        nome_inscrito: String(nome_inscrito).trim(),
        cpf: cpfLimpo || null, email: email ? String(email).trim() : null,
        whatsapp: whatsapp ? String(whatsapp).trim() : null,
        sexo: sexo || null, data_nascimento: data_nascimento || null,
        supervisao_id: supervisao_id || null, campo_id: campo_id || null,
        hospedagem: !!hospedagem, alimentacao: incluiAlimentacao, brinde: !!brinde,
        tipo_inscricao: tipoNome,
        valor_original: vOriginal, cupom_codigo: cupomCodigo, desconto_valor: vDesconto,
        valor_final: vFinal, valor_pago: isGratuito2 ? 0 : isPresencial ? vFinal : 0,
        status_pagamento: statusPag, forma_pagamento: formaPagSalva,
        refeicoes_total: quantidadeRefeicoes,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: quantidadeRefeicoes,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: quantidadeRefeicoes,
        observacoes: observacoes ? String(observacoes).trim() : null,
        qr_code: qrFinal, operador_id: operadorId, ministro_snapshot: ministroSnapshot,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade ? String(hosp_descricao_necessidade).trim() : null,
        hosp_cama_inferior: hospCamaInferiorAuto,
        hosp_observacoes: hosp_observacoes ? String(hosp_observacoes).trim() : null,
        hosp_possui_comorbidade: hospPossuiComorbidade,
        hosp_descricao_comorbidade: hospDescricaoComorbidade,
        grupo_hospedagem: grupoHospedagemAuto,
        lgpd_aceito: true, lgpd_aceito_em: new Date().toISOString(),
      });

      const rowEsposa = normalizePayloadUppercase({
        evento_id: eventoId, lote_id: lote2.id,
        nome_inscrito: String(esposaData.nome_inscrito ?? '').trim(),
        cpf: String(esposaData.cpf ?? '').replace(/\D/g, '') || null,
        whatsapp: esposaData.whatsapp ? String(esposaData.whatsapp).trim() : null,
        sexo: 'F', data_nascimento: esposaData.data_nascimento || null,
        supervisao_id: supervisao_id || null, campo_id: campo_id || null,
        hospedagem: !!esposaData.hospedagem, alimentacao: !!(tipoEsposa?.inclui_alimentacao), brinde: false,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        valor_original: valorEsposaBase, cupom_codigo: null, desconto_valor: 0,
        valor_final: valorEsposaBase, valor_pago: isGratuito2 ? 0 : isPresencial ? valorEsposaBase : 0,
        status_pagamento: statusPag, forma_pagamento: formaPagSalva,
        qr_code: esposaData.qr_code ? String(esposaData.qr_code) : generateQRCodeToken(),
        refeicoes_total: refeicoesEsposa,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: refeicoesEsposa,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: refeicoesEsposa,
        operador_id: operadorId,
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_descricao_necessidade: esposaData.hosp_descricao_necessidade ? String(esposaData.hosp_descricao_necessidade).trim() : null,
        hosp_cama_inferior: esposaCamaInferiorAuto,
        hosp_observacoes: esposaData.hosp_observacoes ? String(esposaData.hosp_observacoes).trim() : null,
        hosp_possui_comorbidade: esposaComorbidade,
        hosp_descricao_comorbidade: esposaData.hosp_descricao_comorbidade ? String(esposaData.hosp_descricao_comorbidade).trim() : null,
        grupo_hospedagem: esposaGrupoAuto,
        lgpd_aceito: true, lgpd_aceito_em: new Date().toISOString(),
      });

      const { data: insRows, error: insErr2 } = await supabase
        .from('evento_inscricoes').insert([rowPastor, rowEsposa]).select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado');

      if (insErr2 || !insRows || insRows.length < 2) {
        return NextResponse.json({ error: 'Erro ao inserir inscrições do casal.' }, { status: 500 });
      }

      const [insPastor, insEsposa] = insRows as { id: string }[];

      // Hospedagem
      if (!!hospedagem) {
        const priorPastor = calcularPrioridadeHospedagem({ id: insPastor.id, nome_inscrito: String(nome_inscrito).trim(), sexo: sexo ? String(sexo) : null, data_nascimento: data_nascimento ? String(data_nascimento) : null, tipo_inscricao: tipo_inscricao ? String(tipo_inscricao) : null, hosp_necessidade_especial: !!hosp_necessidade_especial, hosp_descricao_necessidade: hosp_descricao_necessidade ? String(hosp_descricao_necessidade).trim() : null, hosp_cama_inferior: hospCamaInferiorAuto, hosp_observacoes: hosp_observacoes ? String(hosp_observacoes).trim() : null, hosp_possui_comorbidade: hospPossuiComorbidade, hosp_descricao_comorbidade: hospDescricaoComorbidade });
        await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: eventoId, inscricao_id: insPastor.id, status: 'solicitada', prioridade: priorPastor, necessidade_especial: !!hosp_necessidade_especial, descricao_necessidade: hosp_descricao_necessidade ? String(hosp_descricao_necessidade).trim() : null, cama_inferior: hospCamaInferiorAuto, observacoes: hosp_observacoes ? String(hosp_observacoes).trim() : null, grupo_hospedagem: grupoHospedagemAuto, alocacao_automatica: true })]);
      }
      if (!!esposaData.hospedagem) {
        const priorEsposa = calcularPrioridadeHospedagem({ id: insEsposa.id, nome_inscrito: String(esposaData.nome_inscrito ?? ''), sexo: 'F', data_nascimento: esposaData.data_nascimento ? String(esposaData.data_nascimento) : null, tipo_inscricao: 'Esposa de Pastor Presidente', hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial, hosp_descricao_necessidade: esposaData.hosp_descricao_necessidade ? String(esposaData.hosp_descricao_necessidade).trim() : null, hosp_cama_inferior: esposaCamaInferiorAuto, hosp_observacoes: esposaData.hosp_observacoes ? String(esposaData.hosp_observacoes).trim() : null, hosp_possui_comorbidade: esposaComorbidade, hosp_descricao_comorbidade: esposaData.hosp_descricao_comorbidade ? String(esposaData.hosp_descricao_comorbidade).trim() : null });
        await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: eventoId, inscricao_id: insEsposa.id, status: 'solicitada', prioridade: priorEsposa, necessidade_especial: !!esposaData.hosp_necessidade_especial, descricao_necessidade: esposaData.hosp_descricao_necessidade ? String(esposaData.hosp_descricao_necessidade).trim() : null, cama_inferior: esposaCamaInferiorAuto, observacoes: esposaData.hosp_observacoes ? String(esposaData.hosp_observacoes).trim() : null, grupo_hospedagem: esposaGrupoAuto, alocacao_automatica: true })]);
      }

      if (cupomCodigo) await incrementarCupom(supabase, eventoId, cupomCodigo);

      if (isAsaas) {
        try {
          const customerId2 = await createOrFindAsaasCustomer({ nome: String(nome_inscrito).trim(), email: email ? String(email).trim() : null, cpf: cleanCpf(cpfLimpo ?? ''), whatsapp: whatsapp ? String(whatsapp) : null });
          const dueDate2 = dueDateFromNow();
          const pagamento2 = await createEventoPayment({ customerId: customerId2, value: valorTotal2, dueDate: dueDate2, description: `Inscrição Casal CM Balcão — ${(evento as any).nome}`, externalReference: `lote:${lote2.id}` });
          await supabase.from('evento_lotes_inscricao').update({ asaas_payment_id: pagamento2.id, invoice_url: pagamento2.invoiceUrl, pix_copia_cola: pagamento2.pixCopiaECola, pix_qr_code: pagamento2.pixQrCode, asaas_due_date: dueDate2 }).eq('id', lote2.id);
          return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, inscricao: insRows[0], statusPagamento: 'aguardando_pagamento', pagamento: { invoiceUrl: pagamento2.invoiceUrl, pixCopiaECola: pagamento2.pixCopiaECola, valor: valorTotal2 } });
        } catch (asaasErr2) {
          console.error('[BALCAO CASAL ASAAS]', (asaasErr2 as Error).message);
          return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, inscricao: insRows[0], statusPagamento: 'pendente', pagamento: null, asaasError: 'Cobrança ASAAS não gerada.' });
        }
      }

      return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, inscricao: insRows[0], statusPagamento: statusPag, pagamento: null });
    }

    // Monta payload
    const inscricaoPayload = normalizePayloadUppercase({
      evento_id:        eventoId,
      nome_inscrito:    String(nome_inscrito).trim(),
      cpf:              cpfLimpo || null,
      email:            email ? String(email).trim() : null,
      whatsapp:         whatsapp ? String(whatsapp).trim() : null,
      sexo:             sexo || null,
      data_nascimento:  data_nascimento || null,
      supervisao_id:    supervisao_id || null,
      campo_id:         campo_id || null,
      hospedagem:       !!hospedagem,
      alimentacao:      incluiAlimentacao,
      brinde:           !!brinde,
      tipo_inscricao:   tipoNome,
      valor_original:   vOriginal,
      cupom_codigo:     cupomCodigo,
      desconto_valor:   vDesconto,
      valor_final:      vFinal,
      valor_pago:       isGratuito ? 0 : isPresencial ? vFinal : 0,
      status_pagamento: statusPag,
      forma_pagamento:  formaPagSalva,
      refeicoes_total: quantidadeRefeicoes,
      refeicoes_utilizadas: 0,
      quantidade_refeicoes_total: quantidadeRefeicoes,
      quantidade_refeicoes_usadas: 0,
      quantidade_refeicoes_saldo: quantidadeRefeicoes,
      observacoes:      observacoes ? String(observacoes).trim() : null,
      qr_code:          qrFinal,
      operador_id:      operadorId,
      ministro_snapshot: ministroSnapshot,
      hosp_necessidade_especial:  !!hosp_necessidade_especial,
      hosp_descricao_necessidade: hosp_descricao_necessidade
        ? String(hosp_descricao_necessidade).trim()
        : null,
      hosp_cama_inferior:  hospCamaInferiorAuto,
      hosp_observacoes:    hosp_observacoes ? String(hosp_observacoes).trim() : null,
      hosp_possui_comorbidade: hospPossuiComorbidade,
      hosp_descricao_comorbidade: hospDescricaoComorbidade,
      grupo_hospedagem:    grupoHospedagemAuto,
      lgpd_aceito:         true,
      lgpd_aceito_em:      new Date().toISOString(),
    });

    // Insere via service role (bypassa RLS)
    const { data: inscricao, error: insErr } = await supabase
      .from('evento_inscricoes')
      .insert([inscricaoPayload])
      .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado')
      .single();

    if (insErr || !inscricao) {
      console.error('[BALCAO] Erro ao inserir inscrição:', insErr);
      return NextResponse.json({
        error: 'Erro ao salvar inscrição.',
        stage: 'insert_evento_inscricoes',
        details: insErr?.message ?? 'sem detalhes',
        code: insErr?.code ?? null,
        hint: insErr?.hint ?? null,
      }, { status: 500 });
    }

    const inscricaoId = (inscricao as any).id as string;

    // Incrementa cupom
    if (cupomCodigo) {
      await incrementarCupom(supabase, eventoId, cupomCodigo);
    }

    // Hospedagem AGO
    if (!!hospedagem && (evento as any).departamento === 'AGO') {
      const prioridade = calcularPrioridadeHospedagem({
        id:                         inscricaoId,
        nome_inscrito:              String(nome_inscrito).trim(),
        sexo:                       sexo ? String(sexo) : null,
        data_nascimento:            data_nascimento ? String(data_nascimento) : null,
        tipo_inscricao:             tipoNome,
        hosp_necessidade_especial:  !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade
          ? String(hosp_descricao_necessidade).trim()
          : null,
        hosp_cama_inferior: hospCamaInferiorAuto,
        hosp_observacoes:   hosp_observacoes ? String(hosp_observacoes).trim() : null,
        hosp_possui_comorbidade: hospPossuiComorbidade,
        hosp_descricao_comorbidade: hospDescricaoComorbidade,
      });
      await supabase.from('evento_hospedagens').insert([
        normalizePayloadUppercase({
          evento_id:            eventoId,
          inscricao_id:         inscricaoId,
          status:               'solicitada',
          prioridade,
          necessidade_especial: !!hosp_necessidade_especial,
          descricao_necessidade: hosp_descricao_necessidade
            ? String(hosp_descricao_necessidade).trim()
            : null,
          cama_inferior:  hospCamaInferiorAuto,
          observacoes:    hosp_observacoes ? String(hosp_observacoes).trim() : null,
          grupo_hospedagem: grupoHospedagemAuto,
          alocacao_automatica: true,
        }),
      ]);
    }

    // Auditoria (fire-and-forget)
    void logDB({
      userId:      operadorId,
      userEmail:   operadorEmail,
      acao:        'criar_inscricao_balcao',
      modulo:      'eventos',
      entidade:    'evento_inscricoes',
      entidadeId:  inscricaoId,
      descricao:   `[Balcão] Nova inscrição: ${String(nome_inscrito).trim()} — ${(evento as any).nome}`,
      detalhes: {
        evento_id:        eventoId,
        forma_pagamento:  formaStr,
        valor_final:      vFinal,
        status_pagamento: statusPag,
        operador_id:      operadorId,
      },
      request,
    });

    // ASAAS: cria cobrança
    if (isAsaas) {
      try {
        const customerId = await createOrFindAsaasCustomer({
          nome:     String(nome_inscrito).trim(),
          email:    email ? String(email).trim() : null,
          cpf:      cleanCpf(cpfLimpo ?? ''),
          whatsapp: whatsapp ? String(whatsapp) : null,
        });

        const pagamento = await createEventoPayment({
          customerId,
          value:             vFinal,
          dueDate:           dueDateFromNow(),
          description:       `Inscrição Balcão — ${(evento as any).nome}${tipoNome ? ` (${tipoNome})` : ''}`,
          externalReference: inscricaoId,
        });

        await supabase
          .from('evento_inscricoes')
          .update({
            asaas_payment_id: pagamento.id,
            forma_pagamento:  'pix',
            invoice_url:      pagamento.invoiceUrl,
            pix_copia_cola:   pagamento.pixCopiaECola,
            pix_qr_code:      pagamento.pixQrCode,
            asaas_due_date:   dueDateFromNow(),
          })
          .eq('id', inscricaoId);

        return NextResponse.json({
          inscricaoId,
          inscricao,
          statusPagamento: 'aguardando_pagamento',
          pagamento: {
            invoiceUrl:    pagamento.invoiceUrl,
            pixCopiaECola: pagamento.pixCopiaECola,
            valor:         vFinal,
          },
        });
      } catch (asaasErr) {
        const msg = asaasErr instanceof Error ? asaasErr.message : String(asaasErr);
        console.error('[BALCAO ASAAS] Erro ao criar cobrança:', msg);
        return NextResponse.json({
          inscricaoId,
          inscricao,
          statusPagamento: 'pendente',
          pagamento:       null,
          asaasError:      'Cobrança ASAAS não gerada. Use outra forma de pagamento.',
        });
      }
    }

    return NextResponse.json({
      inscricaoId,
      inscricao,
      statusPagamento: statusPag,
      pagamento:       null,
    });
  } catch (err) {
    console.error('[BALCAO] Erro inesperado:', err);
    return NextResponse.json({ error: 'Erro inesperado no servidor.' }, { status: 500 });
  }
}
