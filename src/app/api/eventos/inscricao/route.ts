import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { isEventoInscricaoPublicaDisponivel } from '@/lib/eventos/evento-listing';
import {
  createOrFindAsaasCustomer,
  createEventoPayment,
} from '@/lib/asaas';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import { parseCampoMissionarioConfig } from '@/lib/ago-regras';
import {
  calcularPrioridadeHospedagem,
  resolveCamaInferiorAutomatica,
  resolveGrupoHospedagemAGO,
} from '@/lib/hospedagem-helpers';

type ErrorJson = {
  error: string;
  stage: string;
  details?: string | null;
  code?: string | null;
  payloadResumo?: Record<string, unknown>;
};

const VENCIMENTO_DIAS = 3;

function dueDateFromNow(dias = VENCIMENTO_DIAS): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function gerarCodigoLote(): string {
  return 'LOTE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function buildErrorResponse(
  status: number,
  data: ErrorJson,
) {
  return NextResponse.json(data, { status });
}

function extractMissingColumn(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const m = msg.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of\s+relation\s+"?[a-zA-Z0-9_]+"?\s+does not exist/i)
    || msg.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
  return m?.[1] ?? null;
}

async function insertInscricaoComFallback(
  supabase: ReturnType<typeof createServerClient>,
  payload: Record<string, unknown>,
) {
  const candidate = { ...payload };
  const colunasRemovidas: string[] = [];

  for (let tentativa = 1; tentativa <= 8; tentativa++) {
    const { data, error } = await supabase
      .from('evento_inscricoes')
      .insert([candidate])
      .select('id')
      .single();

    if (!error && data) {
      return { data, error: null as null, colunasRemovidas };
    }

    const missing = extractMissingColumn(error?.message);
    if (!missing || !(missing in candidate)) {
      return { data: null, error, colunasRemovidas };
    }

    delete candidate[missing];
    colunasRemovidas.push(missing);
    console.warn('[INSCRICAO][fallback_coluna_ausente]', { tentativa, missing });
  }

  return { data: null, error: { message: 'Falha ao inserir inscrição após fallback de colunas.', code: 'FALLBACK_MAX_RETRIES' }, colunasRemovidas };
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
  let stage = 'init';
  let payloadResumo: Record<string, unknown> = {};
  try {
    stage = 'parse_payload';
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
      hosp_observacoes,
    } = body;

    const hospPossuiComorbidade = !!(body as any).hosp_possui_comorbidade;
    const hospDescricaoComorbidade = ((body as any).hosp_descricao_comorbidade as string)?.trim() || null;
    let hospCamaInferiorAuto = false;
    let grupoHospedagemAuto: string | null = null;

    payloadResumo = {
      evento_slug: slug ?? null,
      nome: nome_inscrito ?? null,
      cpf: cpf ?? null,
      tipo_inscricao: tipo_inscricao ?? null,
      valor_final: null,
      alimentacao: null,
      hospedagem: hospedagem ?? null,
    };

    console.info('[INSCRICAO][payload_recebido]', {
      stage,
      slug,
      nome_inscrito,
      cpf: cpf ? String(cpf).replace(/\d(?=\d{4})/g, '*') : null,
      tipo_inscricao,
      incluir_esposa: !!incluir_esposa,
      possui_lote: Array.isArray(participantes) && participantes.length > 0,
    });

    if (!slug || !nome_inscrito?.trim() || !supervisao_id) {
      return buildErrorResponse(400, {
        error: 'Campos obrigatórios ausentes',
        stage: 'validacao_campos_obrigatorios',
        payloadResumo,
      });
    }

    const supabase = createServerClient();

    // ── Busca evento ──────────────────────────────────────────
    stage = 'buscar_evento';
    const { data: evento, error: evErr } = await supabase
      .from('eventos')
      .select('id, nome, valor_inscricao, usar_tipos_inscricao, inscricoes_abertas, limite_vagas, limite_hospedagem, limite_brindes, status, departamento, configuracoes_ago')
      .eq('slug', slug)
      .single();

    console.info('[INSCRICAO][evento_encontrado]', {
      stage,
      ok: !!evento && !evErr,
      evento_id: evento?.id ?? null,
      departamento: evento?.departamento ?? null,
      usar_tipos_inscricao: (evento as any)?.usar_tipos_inscricao ?? null,
    });

    if (evErr || !evento) {
      return buildErrorResponse(404, {
        error: 'Evento não encontrado',
        stage,
        details: evErr?.message ?? null,
        code: (evErr as any)?.code ?? null,
        payloadResumo,
      });
    }

    if (!isEventoInscricaoPublicaDisponivel(evento)) {
      return buildErrorResponse(409, {
        error: 'Inscrições encerradas',
        stage: 'validacao_evento_disponivel',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }

    // ── Valida uso de tipos de inscrição ─────────────────────────────────
    const usaTipos = !!(evento as Record<string, unknown>).usar_tipos_inscricao;
    if (usaTipos && !tipo_inscricao) {
      return buildErrorResponse(400, {
        error: 'Selecione uma modalidade de inscrição.',
        stage: 'validacao_tipo_inscricao',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }

    // ── Busca tipo de inscrição (se informado) ────────────────────────
    let valorBase  = evento.valor_inscricao ?? 0;
    let tipoNome   = usaTipos ? ((tipo_inscricao as string | null) ?? null) : null;
    let tipoInclui = { alimentacao: false, hospedagem: !!hospedagem };
    let tipoRefeicoes = 0;

    stage = 'buscar_tipo_inscricao';
    if (tipo_inscricao && usaTipos) {
      const { data: tipo, error: tipoErr } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, valor, inclui_alimentacao, inclui_hospedagem, quantidade_refeicoes')
        .eq('evento_id', evento.id)
        .ilike('nome', String(tipo_inscricao).trim())
        .eq('ativo', true)
        .maybeSingle();
      if (tipoErr) {
        return buildErrorResponse(500, {
          error: 'Erro ao buscar categoria de inscrição.',
          stage,
          details: tipoErr.message,
          code: (tipoErr as any)?.code ?? null,
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }
      if (!tipo) {
        return buildErrorResponse(400, {
          error: 'Selecione uma categoria de inscrição válida.',
          stage,
          details: `Categoria não encontrada/inativa: ${String(tipo_inscricao).trim()}`,
          code: 'TIPO_INSCRICAO_INVALIDO',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      valorBase  = tipo.valor;
      tipoNome   = tipo.nome;
      tipoInclui = { alimentacao: tipo.inclui_alimentacao, hospedagem: tipo.inclui_hospedagem };
      tipoRefeicoes = (tipo.inclui_alimentacao && tipo.quantidade_refeicoes > 0)
        ? tipo.quantidade_refeicoes
        : 0;
    }

    console.info('[INSCRICAO][tipo_encontrado]', {
      stage,
      usaTipos,
      tipo_inscricao: tipoNome,
      inclui_alimentacao: tipoInclui.alimentacao,
      inclui_hospedagem: tipoInclui.hospedagem,
      quantidade_refeicoes: tipoRefeicoes,
    });

    // ── Aplica cupom ──────────────────────────────────────────
    let desconto   = 0;
    let valorFinal = valorBase;
    let cupomUsado = null as string | null;

    stage = 'calculo_valor';
    if (cupom_codigo) {
      const result = await calcularDesconto(supabase, evento.id, cupom_codigo, valorBase);
      if (result) {
        desconto   = result.desconto;
        valorFinal = result.valorFinal;
        cupomUsado = String(cupom_codigo).trim().toUpperCase();
      }
    }

    console.info('[INSCRICAO][calculo_valor]', {
      stage,
      evento_id: evento.id,
      valor_base: valorBase,
      desconto,
      valor_final: valorFinal,
      cupom: cupomUsado,
    });

    // ── Verifica vagas gerais ─────────────────────────────────
    const ehLote   = Array.isArray(participantes) && participantes.length > 0;
    const qtdTotal = ehLote ? 1 + participantes.length : 1;

    if (evento.limite_vagas) {
      const { count } = await supabase
        .from('evento_inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', evento.id);
      if ((count ?? 0) + qtdTotal > evento.limite_vagas) {
        return buildErrorResponse(409, {
          error: 'Vagas insuficientes',
          stage: 'validacao_vagas',
          details: `Disponíveis: ${Math.max(0, evento.limite_vagas - (count ?? 0))}; solicitadas: ${qtdTotal}`,
          code: 'VAGAS_INSUFICIENTES',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }
    }

    // ── Verifica vagas de hospedagem ──────────────────────────
    // AGO: hospedagem sempre opt-in explícito; não herda automaticamente do tipo.
    stage = 'calculo_hospedagem';
    const querHospedagem = evento.departamento === 'AGO'
      ? !!hospedagem
      : (tipoInclui.hospedagem || !!hospedagem);

    if (evento.departamento === 'AGO') {
      hospCamaInferiorAuto = resolveCamaInferiorAutomatica({
        sexo: sexo || null,
        data_nascimento: data_nascimento || null,
        tipo_inscricao: tipoNome || null,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_possui_comorbidade: hospPossuiComorbidade,
      });
      grupoHospedagemAuto = resolveGrupoHospedagemAGO({
        sexo: sexo || null,
        data_nascimento: data_nascimento || null,
        tipo_inscricao: tipoNome || null,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_possui_comorbidade: hospPossuiComorbidade,
      });
    }
    // Para lote: conta todos os participantes que terão hospedagem
    const qtdComHospedagem = ehLote
      ? (querHospedagem ? 1 : 0) + (Array.isArray(participantes)
          ? (participantes as { hospedagem?: boolean }[]).filter(p => evento.departamento === 'AGO' ? !!p.hospedagem : (tipoInclui.hospedagem || !!p.hospedagem)).length
          : 0)
      : (querHospedagem ? 1 : 0);

    console.info('[INSCRICAO][calculo_hospedagem]', {
      stage,
      querHospedagem,
      qtdComHospedagem,
      ehLote,
    });

    if (qtdComHospedagem > 0 && evento.limite_hospedagem) {
      const { count: hospCount } = await supabase
        .from('evento_inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', evento.id)
        .eq('hospedagem', true);
      if ((hospCount ?? 0) + qtdComHospedagem > evento.limite_hospedagem) {
        return buildErrorResponse(409, {
          error: 'Vagas de hospedagem insuficientes',
          stage: 'validacao_vagas_hospedagem',
          payloadResumo: { ...payloadResumo, evento_id: evento.id, hospedagem: querHospedagem },
        });
      }
    }

    const isGratuito = valorFinal <= 0;

    if (!isGratuito && !isValidCpf(cpf)) {
      return buildErrorResponse(400, {
        error: 'CPF invalido. Confira o CPF do responsavel para gerar o pagamento online.',
        stage: 'validacao_cpf',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }

    // ── Snapshot ministerial (AGO) — não bloqueia se não encontrar ──────
    stage = 'snapshot_ministerial';
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

    console.info('[INSCRICAO][calculo_alimentacao]', {
      stage: 'calculo_alimentacao',
      evento_id: evento.id,
      tipo_inscricao: tipoNome,
      alimentacao: tipoInclui.alimentacao,
      quantidade_refeicoes: tipoRefeicoes,
    });

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

      // Busca tipo "Esposa de Pastor Presidente*" para nome e inclui_alimentacao
      const { data: tipoEsposa } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, inclui_hospedagem, quantidade_refeicoes')
        .eq('evento_id', evento.id)
        .ilike('nome', 'Esposa de Pastor Presidente%')
        .eq('ativo', true)
        .maybeSingle();

      const refeicoesPastor = tipoInclui.alimentacao ? tipoRefeicoes : 0;
      const refeicoesEsposa = tipoEsposa?.inclui_alimentacao
        ? Math.max(0, Number(tipoEsposa?.quantidade_refeicoes ?? 0))
        : 0;

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

      if (loteErr2 || !lote2) {
        return buildErrorResponse(500, {
          error: 'Erro ao criar lote do casal',
          stage: 'insert_lote_casal',
          details: loteErr2?.message ?? null,
          code: (loteErr2 as any)?.code ?? null,
          payloadResumo: { ...payloadResumo, evento_id: evento.id, valor_final: valorTotal2 },
        });
      }

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
        refeicoes_total:  refeicoesPastor,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: refeicoesPastor,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: refeicoesPastor,
        ministro_snapshot: ministroSnapshot,
        hosp_necessidade_especial:  !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
        hosp_cama_inferior:         hospCamaInferiorAuto,
        hosp_observacoes:           hosp_observacoes?.trim() || null,
        hosp_possui_comorbidade:    hospPossuiComorbidade,
        hosp_descricao_comorbidade: hospDescricaoComorbidade,
        grupo_hospedagem:           grupoHospedagemAuto,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      });

      const esposaData = esposa as Record<string, unknown>;
      const esposaComorbidade = !!esposaData.hosp_possui_comorbidade;
      const esposaCamaInferiorAuto = resolveCamaInferiorAutomatica({
        sexo: 'F',
        data_nascimento: esposaData.data_nascimento as string | null,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_possui_comorbidade: esposaComorbidade,
      });
      const esposaGrupoAuto = resolveGrupoHospedagemAGO({
        sexo: 'F',
        data_nascimento: esposaData.data_nascimento as string | null,
        tipo_inscricao: tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial,
        hosp_possui_comorbidade: esposaComorbidade,
      });
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
        tipo_inscricao:   tipoEsposa?.nome ?? 'Esposa de Pastor Presidente Campo Missionário',
        valor_original:   valorEsposaBase,
        cupom_codigo:     null,
        desconto_valor:   0,
        valor_final:      valorEsposaBase,
        valor_pago:       valorEsposaBase,
        status_pagamento: isGratuito2 ? 'isento' : 'pendente',
        qr_code:          esposaData.qr_code || null,
        refeicoes_total:  refeicoesEsposa,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: refeicoesEsposa,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: refeicoesEsposa,
        hosp_necessidade_especial:  !!esposaData.hosp_necessidade_especial,
        hosp_descricao_necessidade: String(esposaData.hosp_descricao_necessidade ?? '').trim() || null,
        hosp_cama_inferior:         esposaCamaInferiorAuto,
        hosp_observacoes:           String(esposaData.hosp_observacoes ?? '').trim() || null,
        hosp_possui_comorbidade:    esposaComorbidade,
        hosp_descricao_comorbidade: String(esposaData.hosp_descricao_comorbidade ?? '').trim() || null,
        grupo_hospedagem:           esposaGrupoAuto,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      });

      const { data: insRows, error: insErr2 } = await supabase
        .from('evento_inscricoes')
        .insert([rowPastor, rowEsposa])
        .select('id');

      if (insErr2 || !insRows || insRows.length < 2) {
        return buildErrorResponse(500, {
          error: 'Erro ao inserir inscrições do casal',
          stage: 'insert_evento_inscricoes_casal',
          details: insErr2?.message ?? null,
          code: (insErr2 as any)?.code ?? null,
          payloadResumo: { ...payloadResumo, evento_id: evento.id, valor_final: valorTotal2, alimentacao: tipoInclui.alimentacao, hospedagem: querHospedagem },
        });
      }

      const [insPastor, insEsposa] = insRows;

      // Cria registros de hospedagem AGO se solicitados
      if (evento.departamento === 'AGO') {
        if (!!hospedagem) {
          const priorPastor = calcularPrioridadeHospedagem({ id: insPastor.id, nome_inscrito: nome_inscrito.trim(), sexo: sexo || null, data_nascimento: data_nascimento || null, tipo_inscricao: tipoNome, hosp_necessidade_especial: !!hosp_necessidade_especial, hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null, hosp_cama_inferior: hospCamaInferiorAuto, hosp_observacoes: hosp_observacoes?.trim() || null, hosp_possui_comorbidade: hospPossuiComorbidade, hosp_descricao_comorbidade: hospDescricaoComorbidade });
          await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: evento.id, inscricao_id: insPastor.id, status: 'solicitada', prioridade: priorPastor, necessidade_especial: !!hosp_necessidade_especial, descricao_necessidade: hosp_descricao_necessidade?.trim() || null, cama_inferior: hospCamaInferiorAuto, observacoes: hosp_observacoes?.trim() || null, grupo_hospedagem: grupoHospedagemAuto, alocacao_automatica: true })]);
        }
        if (!!esposaData.hospedagem) {
          const priorEsposa = calcularPrioridadeHospedagem({ id: insEsposa.id, nome_inscrito: String(esposaData.nome_inscrito ?? ''), sexo: 'F', data_nascimento: esposaData.data_nascimento as string | null, tipo_inscricao: 'Esposa de Pastor Presidente', hosp_necessidade_especial: !!esposaData.hosp_necessidade_especial, hosp_descricao_necessidade: String(esposaData.hosp_descricao_necessidade ?? '').trim() || null, hosp_cama_inferior: esposaCamaInferiorAuto, hosp_observacoes: String(esposaData.hosp_observacoes ?? '').trim() || null, hosp_possui_comorbidade: esposaComorbidade, hosp_descricao_comorbidade: String(esposaData.hosp_descricao_comorbidade ?? '').trim() || null });
          await supabase.from('evento_hospedagens').insert([normalizePayloadUppercase({ evento_id: evento.id, inscricao_id: insEsposa.id, status: 'solicitada', prioridade: priorEsposa, necessidade_especial: !!esposaData.hosp_necessidade_especial, descricao_necessidade: String(esposaData.hosp_descricao_necessidade ?? '').trim() || null, cama_inferior: esposaCamaInferiorAuto, observacoes: String(esposaData.hosp_observacoes ?? '').trim() || null, grupo_hospedagem: esposaGrupoAuto, alocacao_automatica: true })]);
        }
      }

      if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado);

      if (isGratuito2) {
        return NextResponse.json({ inscricaoId: insPastor.id, loteId: lote2.id, inscricoes: 2, statusPagamento: 'isento', pagamento: null });
      }

      try {
        stage = 'criar_asaas_casal';
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

      stage = 'insert_lote';
      const { data: lote, error: loteErr } = await supabase
        .from('evento_lotes_inscricao')
        .insert([lotePayload])
        .select('id')
        .single();

      if (loteErr || !lote) {
        return buildErrorResponse(500, {
          error: 'Erro ao criar lote',
          stage,
          details: loteErr?.message ?? null,
          code: (loteErr as any)?.code ?? null,
          payloadResumo: { ...payloadResumo, evento_id: evento.id, valor_final: valorTotalLote },
        });
      }

      const rows = todos.map(p => {
        const pComorb = !!(p as any).hosp_possui_comorbidade;
        const pCamaInferiorAuto = evento.departamento === 'AGO'
          ? resolveCamaInferiorAutomatica({
            sexo: (p.sexo as string) || null,
            data_nascimento: (p.data_nascimento as string) || null,
            tipo_inscricao: tipoNome,
            hosp_necessidade_especial: !!(p as any).hosp_necessidade_especial,
            hosp_possui_comorbidade: pComorb,
          })
          : false;
        const pGrupoAuto = evento.departamento === 'AGO'
          ? resolveGrupoHospedagemAGO({
            sexo: (p.sexo as string) || null,
            data_nascimento: (p.data_nascimento as string) || null,
            tipo_inscricao: tipoNome,
            hosp_necessidade_especial: !!(p as any).hosp_necessidade_especial,
            hosp_possui_comorbidade: pComorb,
          })
          : null;

        return normalizePayloadUppercase({
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
        alimentacao:      tipoInclui.alimentacao,
        brinde:           !!p.brinde,
        tipo_inscricao:   tipoNome,
        valor_original:   valorBase,
        cupom_codigo:     cupomUsado,
        desconto_valor:   desconto,
        valor_final:      valorFinal,
        valor_pago:       valorFinal,
        status_pagamento: isGratuito ? 'isento' : 'pendente',
        qr_code:          p.qr_code || null,
        refeicoes_total:  tipoInclui.alimentacao ? tipoRefeicoes : 0,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: tipoInclui.alimentacao ? tipoRefeicoes : 0,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: tipoInclui.alimentacao ? tipoRefeicoes : 0,
        hosp_necessidade_especial: !!(p as any).hosp_necessidade_especial,
        hosp_descricao_necessidade: ((p as any).hosp_descricao_necessidade as string)?.trim() || null,
        hosp_cama_inferior: pCamaInferiorAuto,
        hosp_observacoes: ((p as any).hosp_observacoes as string)?.trim() || null,
        hosp_possui_comorbidade: pComorb,
        hosp_descricao_comorbidade: ((p as any).hosp_descricao_comorbidade as string)?.trim() || null,
        grupo_hospedagem: pGrupoAuto,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      });
      });

      stage = 'insert_evento_inscricoes_lote';
      const { error: insRowsErr } = await supabase.from('evento_inscricoes').insert(rows);
      if (insRowsErr) {
        return buildErrorResponse(500, {
          error: 'Erro ao inserir inscrições do lote',
          stage,
          details: insRowsErr?.message ?? null,
          code: (insRowsErr as any)?.code ?? null,
          payloadResumo: { ...payloadResumo, evento_id: evento.id, valor_final: valorTotalLote, alimentacao: tipoInclui.alimentacao, hospedagem: querHospedagem },
        });
      }

      if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado, todos.length);

      if (isGratuito) {
        return NextResponse.json({ loteId: lote.id, inscricoes: todos.length, statusPagamento: 'isento', pagamento: null });
      }

      try {
        stage = 'criar_asaas_lote';
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
      refeicoes_utilizadas: 0,
      quantidade_refeicoes_total: tipoInclui.alimentacao ? tipoRefeicoes : 0,
      quantidade_refeicoes_usadas: 0,
      quantidade_refeicoes_saldo: tipoInclui.alimentacao ? tipoRefeicoes : 0,
      ministro_snapshot: ministroSnapshot,
      // Campos hospedagem AGO
      hosp_necessidade_especial:  !!hosp_necessidade_especial,
      hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
      hosp_cama_inferior:         hospCamaInferiorAuto,
      hosp_observacoes:           hosp_observacoes?.trim() || null,
      hosp_possui_comorbidade:    hospPossuiComorbidade,
      hosp_descricao_comorbidade: hospDescricaoComorbidade,
      grupo_hospedagem:           grupoHospedagemAuto,
      lgpd_aceito:      true,
      lgpd_aceito_em:   new Date().toISOString(),
    });

    payloadResumo = {
      ...payloadResumo,
      evento_id: evento.id,
      tipo_inscricao: tipoNome,
      valor_final: valorFinal,
      alimentacao: tipoInclui.alimentacao,
      hospedagem: querHospedagem,
    };

    stage = 'insert_evento_inscricoes';
    const { data: inscricao, error: insErr, colunasRemovidas } = await insertInscricaoComFallback(
      supabase,
      inscricaoPayload as Record<string, unknown>,
    );

    if (insErr || !inscricao) {
      console.error('[INSCRICAO] Erro ao inserir:', insErr);
      return buildErrorResponse(500, {
        error: 'Erro ao salvar inscrição',
        stage,
        details: (insErr as any)?.message ?? null,
        code: (insErr as any)?.code ?? null,
        payloadResumo: {
          ...payloadResumo,
          colunas_removidas_fallback: colunasRemovidas,
        },
      });
    }

    if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado);

    // Cria registro de hospedagem AGO se evento AGO com hospedagem
    stage = 'insert_evento_hospedagens';
    if (querHospedagem && evento.departamento === 'AGO') {
      const prioridade = calcularPrioridadeHospedagem({
        id: inscricao.id,
        nome_inscrito: nome_inscrito.trim(),
        sexo: sexo || null,
        data_nascimento: data_nascimento || null,
        tipo_inscricao: tipoNome,
        hosp_necessidade_especial: !!hosp_necessidade_especial,
        hosp_descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
        hosp_cama_inferior: hospCamaInferiorAuto,
        hosp_observacoes: hosp_observacoes?.trim() || null,
        hosp_possui_comorbidade: hospPossuiComorbidade,
        hosp_descricao_comorbidade: hospDescricaoComorbidade,
      });
      const hospedagemPayload = normalizePayloadUppercase({
        evento_id:            evento.id,
        inscricao_id:         inscricao.id,
        status:               'solicitada',
        prioridade,
        necessidade_especial: !!hosp_necessidade_especial,
        descricao_necessidade: hosp_descricao_necessidade?.trim() || null,
        cama_inferior:        hospCamaInferiorAuto,
        observacoes:          hosp_observacoes?.trim() || null,
        grupo_hospedagem:     grupoHospedagemAuto,
        alocacao_automatica:  true,
      });
      const { error: hospErr } = await supabase.from('evento_hospedagens').insert([hospedagemPayload]);
      if (hospErr) {
        return buildErrorResponse(500, {
          error: 'Erro ao salvar hospedagem da inscrição',
          stage,
          details: hospErr.message,
          code: (hospErr as any)?.code ?? null,
          payloadResumo,
        });
      }
    }

    if (isGratuito) {
      stage = 'auditoria_isento';
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
      stage = 'criar_asaas_individual';
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
      stage = 'update_evento_inscricoes_asaas';
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

      stage = 'auditoria_pago';
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
    return buildErrorResponse(500, {
      error: 'Erro interno',
      stage,
      details: err?.message ?? String(err),
      code: err?.code ?? null,
      payloadResumo,
    });
  }
}
