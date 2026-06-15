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
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';

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
    || msg.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i)
    || msg.match(/Could not find the '([a-zA-Z0-9_]+)' column/i);
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

async function insertLoteComFallback(
  supabase: ReturnType<typeof createServerClient>,
  rows: Record<string, unknown>[],
) {
  const candidates = rows.map(r => ({ ...r }));
  const colunasRemovidas: string[] = [];

  for (let tentativa = 1; tentativa <= 8; tentativa++) {
    const { error } = await supabase
      .from('evento_inscricoes')
      .insert(candidates);

    if (!error) {
      return { error: null as null, colunasRemovidas };
    }

    const missing = extractMissingColumn(error?.message);
    if (!missing) {
      return { error, colunasRemovidas };
    }

    for (const row of candidates) {
      if (missing in row) delete row[missing];
    }
    colunasRemovidas.push(missing);
    console.warn('[INSCRICAO][fallback_coluna_ausente_lote]', { tentativa, missing });
  }

  return {
    error: { message: 'Falha ao inserir lote após fallback de colunas.', code: 'FALLBACK_MAX_RETRIES' },
    colunasRemovidas,
  };
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

function normalizePhoneCompare(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

async function sincronizarFichaMembroPorInscricao(
  supabase: ReturnType<typeof createServerClient>,
  payload: {
    cpf?: string | null;
    email?: string | null;
    whatsapp?: string | null;
    campoId?: string | null;
  },
) {
  const cpf = String(payload.cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) return;

  const { data: membro, error: membroErr } = await supabase
    .from('members')
    .select('id,email,whatsapp,custom_fields')
    .eq('cpf', cpf)
    .maybeSingle();

  if (membroErr || !membro) return;

  const updates: Record<string, unknown> = {};
  const emailNovo = String(payload.email || '').trim() || null;
  const whatsappNovo = String(payload.whatsapp || '').trim() || null;

  const emailAtualNorm = String((membro as any).email || '').trim().toLowerCase();
  const emailNovoNorm = String(emailNovo || '').toLowerCase();
  if (emailNovo && emailNovoNorm !== emailAtualNorm) {
    updates.email = emailNovo;
  }

  const whatsappAtualNorm = normalizePhoneCompare((membro as any).whatsapp || null);
  const whatsappNovoNorm = normalizePhoneCompare(whatsappNovo);
  if (whatsappNovo && whatsappNovoNorm && whatsappNovoNorm !== whatsappAtualNorm) {
    updates.whatsapp = whatsappNovo;
  }

  const campoId = String(payload.campoId || '').trim();
  if (campoId) {
    const { data: campoRow } = await supabase
      .from('campos')
      .select('nome')
      .eq('id', campoId)
      .maybeSingle();

    const campoNome = String((campoRow as { nome?: string | null } | null)?.nome || '').trim();
    if (campoNome) {
      const cfAtual = ((membro as any).custom_fields && typeof (membro as any).custom_fields === 'object')
        ? ((membro as any).custom_fields as Record<string, unknown>)
        : {};
      const campoAtual = String(cfAtual.campo || '').trim();
      if (campoAtual !== campoNome) {
        updates.custom_fields = {
          ...cfAtual,
          campo: campoNome,
        };
      }
    }
  }

  if (Object.keys(updates).length === 0) return;

  await supabase
    .from('members')
    .update(updates)
    .eq('id', (membro as any).id);
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

    const cpfLimpoInput = cpf?.replace(/\D/g, '') || null;
    const vinculoEsposaJubiladoPorCpf = new Map<string, { ministroId: string; ministroNome: string | null } | null>();
    const resolverVinculoEsposaJubilado = async (cpfParaValidar: string | null | undefined) => {
      const cpfNorm = String(cpfParaValidar || '').replace(/\D/g, '');
      if (cpfNorm.length !== 11) return null;
      if (vinculoEsposaJubiladoPorCpf.has(cpfNorm)) {
        return vinculoEsposaJubiladoPorCpf.get(cpfNorm) || null;
      }

      const { data: rows, error: vincErr } = await supabase
        .from('members')
        .select('id,name,jubilado,status,estado_civil,nome_conjuge,cpf_conjuge')
        .eq('jubilado', true)
        .in('status', ['active', 'ativo'])
        .eq('cpf_conjuge', cpfNorm)
        .limit(10);

      if (vincErr) {
        throw new Error(`Falha ao validar cpf_conjuge de jubilado: ${vincErr.message}`);
      }

      const match = (rows ?? []).find((r) => {
        const cpfConjuge = String((r as any).cpf_conjuge ?? '').replace(/\D/g, '');
        const nomeConjuge = String((r as any).nome_conjuge ?? '').trim();
        const estadoCivilNorm = String((r as any).estado_civil ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();
        return cpfConjuge === cpfNorm
          && cpfConjuge.length === 11
          && !!nomeConjuge
          && estadoCivilNorm.includes('casad');
      }) as { id?: string | null; name?: string | null } | undefined;

      const resolved = match
        ? {
          ministroId: String(match.id || ''),
          ministroNome: match.name ? String(match.name) : null,
        }
        : null;

      vinculoEsposaJubiladoPorCpf.set(cpfNorm, resolved);
      return resolved;
    };

    let vinculoEsposaJubiladoTitular: { ministroId: string; ministroNome: string | null } | null = null;
    if (usaTipos && evento.departamento === 'AGO' && cpfLimpoInput) {
      vinculoEsposaJubiladoTitular = await resolverVinculoEsposaJubilado(cpfLimpoInput);
    }

    let jubiladoAutomatico = false;
    if (usaTipos && evento.departamento === 'AGO' && cpfLimpoInput) {
      const { data: membroTipoAuto } = await supabase
        .from('members')
        .select('jubilado')
        .eq('cpf', cpfLimpoInput)
        .maybeSingle();
      jubiladoAutomatico = !!(membroTipoAuto as any)?.jubilado;
    }

    if (usaTipos && !tipo_inscricao && !jubiladoAutomatico && !vinculoEsposaJubiladoTitular) {
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
    const norm = (v: string | null | undefined) =>
      String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const ehTipoEsposaOuViuva = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('esposa') || n.includes('viuva');
    };

    const ehTipoPastorPresidente = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('pastor presidente') && !ehTipoEsposaOuViuva(n);
    };

    const ehTipoEsposaPastorPresidente = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('esposa') && n.includes('pastor presidente');
    };

    const ehTipoPastorAuxiliar = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('pastor auxiliar') && !ehTipoEsposaOuViuva(n);
    };

    const ehTipoPastorJubilado = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('pastor jubilado') && !ehTipoEsposaOuViuva(n);
    };

    const ehTipoEsposaJubilado = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('esposa') && n.includes('pastor jubilado');
    };

    const ehTipoVisitante = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('visitante');
    };

    const ehCategoriaFeminina = (tipo: string | null | undefined) => {
      const n = norm(tipo);
      return n.includes('esposa') || n.includes('viuva');
    };

    const ehCategoriaMasculina = (tipo: string | null | undefined) => {
      return ehTipoPastorPresidente(tipo) || ehTipoPastorAuxiliar(tipo) || ehTipoPastorJubilado(tipo);
    };

    const normalizarSexo = (valor: unknown): 'M' | 'F' | '' => {
      const raw = String(valor ?? '').trim().toUpperCase();
      if (raw.startsWith('M')) return 'M';
      if (raw.startsWith('F')) return 'F';
      return '';
    };

    type TipoEvento = {
      nome: string;
      valor: number;
      inclui_alimentacao: boolean;
      inclui_hospedagem: boolean;
      quantidade_refeicoes: number | null;
    };

    let tiposAtivos: TipoEvento[] = [];
    if (usaTipos) {
      const { data: tiposData, error: tiposErr } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, valor, inclui_alimentacao, inclui_hospedagem, quantidade_refeicoes')
        .eq('evento_id', evento.id)
        .eq('ativo', true);

      if (tiposErr) {
        return buildErrorResponse(500, {
          error: 'Erro ao buscar categorias de inscrição.',
          stage,
          details: tiposErr.message,
          code: (tiposErr as any)?.code ?? null,
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      tiposAtivos = (tiposData ?? []) as TipoEvento[];
    }

    const resolveTipo = (nome: string | null | undefined) => {
      const alvo = norm(nome);
      if (!alvo) return null;
      return tiposAtivos.find(t => norm(t.nome) === alvo) ?? null;
    };

    if (usaTipos && vinculoEsposaJubiladoTitular) {
      const tipoEsposaJubilado = tiposAtivos.find((t) => ehTipoEsposaJubilado(t.nome)) ?? null;
      if (!tipoEsposaJubilado) {
        return buildErrorResponse(400, {
          error: 'Categoria Esposa de Pastor Jubilado não está disponível para este evento.',
          stage: 'validacao_tipo_esposa_jubilado_indisponivel',
          code: 'TIPO_ESPOSA_JUBILADO_INDISPONIVEL',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      tipoNome = tipoEsposaJubilado.nome;
      valorBase = 0;
      tipoInclui = {
        alimentacao: !!tipoEsposaJubilado.inclui_alimentacao,
        hospedagem: !!tipoEsposaJubilado.inclui_hospedagem,
      };
      tipoRefeicoes = tipoEsposaJubilado.inclui_alimentacao
        ? Math.max(0, Number(tipoEsposaJubilado.quantidade_refeicoes ?? 0))
        : 0;
    } else if (usaTipos && jubiladoAutomatico) {
      const tipoJubilado = tiposAtivos.find((t) => {
        const n = norm(t.nome);
        return n.includes('pastor jubilado') && !n.includes('esposa') && !n.includes('viuva');
      }) ?? null;

      if (tipoJubilado) {
        tipoNome = tipoJubilado.nome;
        valorBase = tipoJubilado.valor;
        tipoInclui = {
          alimentacao: !!tipoJubilado.inclui_alimentacao,
          hospedagem: !!tipoJubilado.inclui_hospedagem,
        };
        tipoRefeicoes = tipoJubilado.inclui_alimentacao
          ? Math.max(0, Number(tipoJubilado.quantidade_refeicoes ?? 0))
          : 0;
      }
    }
    const isRequestedCM = tipo_inscricao && (String(tipo_inscricao).trim().toUpperCase() === 'CAMPO MISSIONÁRIO' || String(tipo_inscricao).trim().toUpperCase() === 'CAMPO MISSIONARIO');
    if (isRequestedCM && usaTipos && !vinculoEsposaJubiladoTitular) {
      if (evento.departamento !== 'AGO') {
        return buildErrorResponse(400, {
          error: 'Categoria de Campo Missionário só é permitida em eventos do tipo AGO.',
          stage,
          code: 'CAMPO_MISSIONARIO_INVALIDO',
          payloadResumo,
        });
      }
      const { data: membro, error: membErr } = await supabase
        .from('members')
        .select('id, name, cpf, status, pastor_presidente, campo_id')
        .eq('cpf', cpfLimpoInput)
        .maybeSingle();

      const statusMinistro = String(membro?.status ?? '').toLowerCase();
      const ministroAtivo = statusMinistro === 'active' || statusMinistro === 'ativo';
      const isPP = !!membro?.pastor_presidente;

      let isCampoMissionario = false;
      if (membro?.campo_id) {
        const { data: campoData } = await supabase
          .from('campos')
          .select('is_campo_missionario')
          .eq('id', membro.campo_id)
          .maybeSingle();
        isCampoMissionario = !!campoData?.is_campo_missionario;
      }

      if (membErr || !membro || !ministroAtivo || !isPP || !isCampoMissionario) {
        return buildErrorResponse(422, {
          error: 'Inscrição não permitida para esta modalidade. Requisitos ministeriais de Campo Missionário não atendidos.',
          stage,
          code: 'CAMPO_MISSIONARIO_NAO_ELEGIVEL',
          payloadResumo,
        });
      }

      const confAgo = (evento as any).configuracoes_ago;
      const cmConfig = parseCampoMissionarioConfig(confAgo);
      let valorCm = 0;
      if (confAgo) {
        if (confAgo.valor_pastor_presidente_campo_missionario !== undefined && confAgo.valor_pastor_presidente_campo_missionario !== null) {
          valorCm = typeof confAgo.valor_pastor_presidente_campo_missionario === 'number'
            ? confAgo.valor_pastor_presidente_campo_missionario
            : parseFloat(String(confAgo.valor_pastor_presidente_campo_missionario)) || 0;
        } else if (cmConfig?.valor_pastor_presidente !== undefined && cmConfig?.valor_pastor_presidente !== null) {
          valorCm = typeof cmConfig.valor_pastor_presidente === 'number'
            ? cmConfig.valor_pastor_presidente
            : parseFloat(String(cmConfig.valor_pastor_presidente)) || 0;
        }
      }

      if (valorCm <= 0) {
        return buildErrorResponse(400, {
          error: 'Valor de Campo Missionário não configurado para este evento.',
          stage,
          code: 'CAMPO_MISSIONARIO_SEM_VALOR',
          payloadResumo,
        });
      }

      valorBase = valorCm;
      tipoNome = 'CAMPO MISSIONÁRIO';
      tipoInclui = { alimentacao: true, hospedagem: true };
      tipoRefeicoes = 12;
    } else if (tipo_inscricao && usaTipos && !vinculoEsposaJubiladoTitular) {
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

    const solicitouEsposaJubilado = ehTipoEsposaJubilado(tipo_inscricao as string | null | undefined)
      || ehTipoEsposaJubilado(tipoNome);

    if (usaTipos && evento.departamento === 'AGO') {
      if (solicitouEsposaJubilado && !vinculoEsposaJubiladoTitular) {
        return buildErrorResponse(400, {
          error: 'Categoria Esposa de Pastor Jubilado exige validação pelo CPF do cônjuge no cadastro do Pastor Jubilado.',
          stage: 'validacao_esposa_jubilado_portal',
          code: 'ESPOSA_JUBILADO_SEM_VINCULO_CPF_CONJUGE',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      if (vinculoEsposaJubiladoTitular && !ehTipoEsposaJubilado(tipoNome)) {
        return buildErrorResponse(400, {
          error: 'CPF vinculado a cônjuge de Pastor Jubilado ativo. A inscrição deve usar a categoria Esposa de Pastor Jubilado.',
          stage: 'validacao_esposa_jubilado_tipo_obrigatorio',
          code: 'ESPOSA_JUBILADO_TIPO_OBRIGATORIO',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }
    }

    // ── Aplica cupom ──────────────────────────────────────────
    let desconto   = 0;
    let valorFinal = valorBase;
    let cupomUsado = null as string | null;

    const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
    const cmConfig = parseCampoMissionarioConfig(confAgo);
    const campoMissionarioEnabled = !!cmConfig?.enabled;
    const valorCmPastorConfigurado = cmConfig
      ? (typeof cmConfig.valor_pastor_presidente === 'number' ? cmConfig.valor_pastor_presidente : parseFloat(String(cmConfig.valor_pastor_presidente)) || 0)
      : 0;
    const valorCmEsposaConfigurado = cmConfig
      ? (typeof cmConfig.valor_esposa === 'number' ? cmConfig.valor_esposa : parseFloat(String(cmConfig.valor_esposa)) || 0)
      : 0;

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
    const calcularHospedagemParticipanteLote = (p: { hospedagem?: boolean; tipo_inscricao?: string }, idx: number): boolean => {
      if (evento.departamento === 'AGO') return !!p.hospedagem;
      const tipoNomeParticipante = idx === 0
        ? (String(tipo_inscricao ?? '').trim() || tipoNome || null)
        : (String(p.tipo_inscricao ?? '').trim() || null);
      const tipoParticipante = tipoNomeParticipante ? resolveTipo(tipoNomeParticipante) : null;
      return !!(tipoParticipante?.inclui_hospedagem || p.hospedagem);
    };

    const qtdComHospedagem = ehLote
      ? (querHospedagem ? 1 : 0) + (Array.isArray(participantes)
          ? (participantes as { hospedagem?: boolean; tipo_inscricao?: string }[])
            .filter((p, i) => calcularHospedagemParticipanteLote(p, i + 1)).length
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
    const cpfLimpo = cpfLimpoInput;
    let ministroSnapshot: Record<string, unknown> | null = null;
    let fluxoCampoMissionarioEspecial = false;
    if (cpfLimpo && evento.departamento === 'AGO') {
      const { data: membro } = await supabase
        .from('members')
        .select('id, name, cpf, matricula, data_nascimento, status, cargo_ministerial, pastor_presidente, pastor_auxiliar, jubilado, campo_id, supervisao_id')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (membro) {
        // Verifica se o campo do membro é missionário
        let isCampoMissionario = false;
        let campoNome: string | null = null;
        let supervisaoNome: string | null = null;
        const campoIdSnapshot = String((membro as any).campo_id ?? campo_id ?? '').trim() || null;
        const supervisaoIdSnapshot = String((membro as any).supervisao_id ?? supervisao_id ?? '').trim() || null;
        if (campoIdSnapshot) {
          const { data: campoData } = await supabase
            .from('campos')
            .select('nome, is_campo_missionario, supervisao_id')
            .eq('id', campoIdSnapshot)
            .maybeSingle();
          if (campoData) {
            isCampoMissionario = !!campoData.is_campo_missionario;
            campoNome = campoData.nome ?? campoNome;
          }
        }

        const isPastorPresidente = !!(membro as any).pastor_presidente;
        const statusMinistro = String((membro as any).status ?? '').toLowerCase();
        const ministroAtivo = statusMinistro === 'active' || statusMinistro === 'ativo';

        fluxoCampoMissionarioEspecial =
          ministroAtivo
          && isPastorPresidente
          && isCampoMissionario
          && campoMissionarioEnabled;

        if (fluxoCampoMissionarioEspecial && valorCmPastorConfigurado > 0 && tipoNome === 'CAMPO MISSIONÁRIO') {
          valorBase = valorCmPastorConfigurado;
          valorFinal = Math.max(0, valorBase - desconto);
        }

        ministroSnapshot = {
          ministro_id: membro.id, nome: membro.name, cpf: membro.cpf,
          matricula: membro.matricula ?? null,
          data_nascimento: membro.data_nascimento ?? null,
          campo: campoNome, campo_id: campoIdSnapshot,
          supervisao: supervisaoNome, supervisao_id: supervisaoIdSnapshot,
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

    if (fluxoCampoMissionarioEspecial && tipoNome && !ehTipoPastorPresidente(tipoNome)) {
      return buildErrorResponse(400, {
        error: 'Campo Missionário exige categoria Pastor Presidente para o titular.',
        stage: 'validacao_campo_missionario_tipo_titular',
        code: 'CAMPO_MISSIONARIO_TIPO_TITULAR_INVALIDO',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }

    if (ministroSnapshot) {
      const statusTitular = String(ministroSnapshot.status_ministerial ?? '').toLowerCase();
      const titularAtivo = statusTitular === 'active' || statusTitular === 'ativo';
      const titularEhPP = !!ministroSnapshot.is_pastor_presidente;
      const titularEhPA = !!ministroSnapshot.is_pastor_auxiliar;
      const titularEhJub = !!ministroSnapshot.is_pastor_jubilado;
      const sexoTitularNorm = normalizarSexo(sexo);
      const titularPodePA = titularEhPA || (titularAtivo && sexoTitularNorm === 'M' && !titularEhPP && !titularEhJub);

      if (titularAtivo && ehTipoVisitante(tipoNome)) {
        return buildErrorResponse(400, {
          error: 'Ministro ativo não pode se inscrever como Visitante.',
          stage: 'validacao_tipo_ministro_ativo_titular',
          code: 'MINISTRO_ATIVO_VISITANTE_NAO_PERMITIDO',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      if (titularAtivo && ehTipoPastorPresidente(tipoNome) && !titularEhPP) {
        return buildErrorResponse(400, {
          error: 'Categoria Pastor Presidente exige flag ministerial de Pastor Presidente ativa.',
          stage: 'validacao_tipo_pastor_presidente_titular',
          code: 'PASTOR_PRESIDENTE_SEM_FLAG',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      if (titularAtivo && ehTipoPastorAuxiliar(tipoNome) && !titularPodePA) {
        return buildErrorResponse(400, {
          error: 'Categoria Pastor Auxiliar não é compatível com o perfil ministerial informado.',
          stage: 'validacao_tipo_pastor_auxiliar_titular',
          code: 'PASTOR_AUXILIAR_INCOMPATIVEL',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }

      if (titularAtivo && titularEhJub && !ehTipoPastorJubilado(tipoNome)) {
        return buildErrorResponse(400, {
          error: 'Ministro jubilado ativo deve usar categoria de Pastor Jubilado.',
          stage: 'validacao_tipo_jubilado_titular',
          code: 'JUBILADO_TIPO_INVALIDO',
          payloadResumo: { ...payloadResumo, evento_id: evento.id },
        });
      }
    }

    const sexoTitularNorm = normalizarSexo(sexo);
    if (sexoTitularNorm === 'M' && ehCategoriaFeminina(tipoNome)) {
      return buildErrorResponse(400, {
        error: 'Categoria feminina inválida para sexo masculino.',
        stage: 'validacao_tipo_por_sexo_titular',
        code: 'TIPO_INVALIDO_SEXO_MASCULINO',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }
    if (sexoTitularNorm === 'F' && ehCategoriaMasculina(tipoNome)) {
      return buildErrorResponse(400, {
        error: 'Categoria masculina inválida para sexo feminino.',
        stage: 'validacao_tipo_por_sexo_titular',
        code: 'TIPO_INVALIDO_SEXO_FEMININO',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }

    if (fluxoCampoMissionarioEspecial && ehLote) {
      return buildErrorResponse(400, {
        error: 'Campo Missionário permite inscrição apenas do Pastor Presidente e, opcionalmente, sua esposa.',
        stage: 'validacao_campo_missionario_lote',
        code: 'CAMPO_MISSIONARIO_EXTRAS_NAO_PERMITIDOS',
        payloadResumo: { ...payloadResumo, evento_id: evento.id },
      });
    }

    // ════════════════════════════════════════════════════════════
    // FLUXO AGO CAMPO MISSIONÁRIO — ESPOSA (2 inscrições, 1 cobrança)
    // ════════════════════════════════════════════════════════════
    const ehEsposaFlow = !!(incluir_esposa) && !!(esposa) && evento.departamento === 'AGO' && fluxoCampoMissionarioEspecial;
    if (ehEsposaFlow) {
      // Busca valor da esposa a partir da config
      const valorEsposaBase = valorCmEsposaConfigurado;

      // Busca tipo "Esposa de Pastor Presidente*" para nome e inclui_alimentacao
      const { data: tipoEsposa } = await supabase
        .from('evento_tipos_inscricao')
        .select('nome, inclui_alimentacao, inclui_hospedagem, quantidade_refeicoes')
        .eq('evento_id', evento.id)
        .ilike('nome', 'Esposa de Pastor Presidente%')
        .eq('ativo', true)
        .maybeSingle();

      const refeicoesPastor = evento.departamento === 'AGO' ? 12 : (tipoInclui.alimentacao ? tipoRefeicoes : 0);
      const refeicoesEsposa = evento.departamento === 'AGO' ? 12 : (tipoEsposa?.inclui_alimentacao
        ? Math.max(0, Number(tipoEsposa?.quantidade_refeicoes ?? 0))
        : 0);

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
        alimentacao:      evento.departamento === 'AGO' ? true : tipoInclui.alimentacao,
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
        alimentacao:      evento.departamento === 'AGO' ? true : !!(tipoEsposa?.inclui_alimentacao),
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

      await Promise.all([
        sincronizarFichaMembroPorInscricao(supabase, {
          cpf: cpf?.replace(/\D/g, '') || null,
          email: email?.trim() || null,
          whatsapp: whatsapp?.trim() || null,
          campoId: campo_id || null,
        }),
        sincronizarFichaMembroPorInscricao(supabase, {
          cpf: String(esposaData.cpf ?? '').replace(/\D/g, '') || null,
          email: null,
          whatsapp: String(esposaData.whatsapp ?? '').trim() || null,
          campoId: campo_id || null,
        }),
      ]);

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
        if (evento.departamento === 'AGO') {
          if (!!hospedagem) {
            await alocarLeitoParaInscricao(supabase, insPastor.id);
          }
          if (!!esposaData.hospedagem) {
            await alocarLeitoParaInscricao(supabase, insEsposa.id);
          }
        }
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

      const ministrosPorCpf = new Map<string, { status: string | null; cargo: string | null; pastor_presidente: boolean; pastor_auxiliar: boolean; jubilado: boolean }>();
      if (evento.departamento === 'AGO') {
        const cpfsParaConsulta = Array.from(new Set(
          todos
            .map((p) => String((p as Record<string, unknown>).cpf ?? '').replace(/\D/g, '').trim())
            .filter((c) => c.length === 11),
        ));
        if (cpfsParaConsulta.length > 0) {
          const { data: membrosRows } = await supabase
            .from('members')
            .select('cpf,status,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado')
            .in('cpf', cpfsParaConsulta);
          for (const m of membrosRows ?? []) {
            ministrosPorCpf.set(String((m as any).cpf), {
              status: (m as any).status ?? null,
              cargo: (m as any).cargo_ministerial ?? null,
              pastor_presidente: !!(m as any).pastor_presidente,
              pastor_auxiliar: !!(m as any).pastor_auxiliar,
              jubilado: !!(m as any).jubilado,
            });
          }
        }
      }

      type ParticipanteCalculado = {
        nome_inscrito: string;
        cpf: string | null;
        email: string | null;
        telefone: string | null;
        whatsapp: string | null;
        sexo: string | null;
        data_nascimento: string | null;
        supervisao_id: string | null;
        campo_id: string | null;
        hospedagem: boolean;
        brinde: boolean;
        qr_code: string | null;
        tipo_inscricao: string | null;
        valor_original: number;
        desconto_valor: number;
        valor_final: number;
        cupom_codigo: string | null;
        alimentacao: boolean;
        refeicoes: number;
        hosp_necessidade_especial: boolean;
        hosp_descricao_necessidade: string | null;
        hosp_observacoes: string | null;
        hosp_possui_comorbidade: boolean;
        hosp_descricao_comorbidade: string | null;
      };

      const confAgo = (evento as any).configuracoes_ago as Record<string, unknown> | null;
      const cmConfig = parseCampoMissionarioConfig(confAgo);
      const descontoCMHabilitado = !!(confAgo?.habilitar_desconto_campo_missionario);
      const valorCmPastor = cmConfig
        ? (typeof cmConfig.valor_pastor_presidente === 'number' ? cmConfig.valor_pastor_presidente : parseFloat(String(cmConfig.valor_pastor_presidente)) || 0)
        : parseFloat(String(confAgo?.valor_pastor_presidente_campo_missionario ?? '0')) || 0;
      const valorCmEsposa = cmConfig
        ? (typeof cmConfig.valor_esposa === 'number' ? cmConfig.valor_esposa : parseFloat(String(cmConfig.valor_esposa)) || 0)
        : 0;

      const campoIds = Array.from(
        new Set(
          todos
            .map(p => String((p as Record<string, unknown>).campo_id ?? '').trim())
            .filter(Boolean),
        ),
      );
      const campoMissionarioMap = new Map<string, boolean>();
      if (campoIds.length > 0) {
        const { data: camposRows } = await supabase
          .from('campos')
          .select('id,is_campo_missionario')
          .in('id', campoIds);
        for (const c of camposRows ?? []) {
          campoMissionarioMap.set(String((c as any).id), !!(c as any).is_campo_missionario);
        }
      }

      const calculados: ParticipanteCalculado[] = [];
      const ppPorCampo = new Map<string, number>();

      const validarPastorPresidentePorCampo = (campoId: string | null, tipoNomeAtual: string | null, participanteOrdem: number) => {
        if (!campoId) return null;
        if (!ehTipoPastorPresidente(tipoNomeAtual)) return null;
        const totalAtual = (ppPorCampo.get(campoId) || 0) + 1;
        ppPorCampo.set(campoId, totalAtual);
        if (totalAtual > 1) {
          return buildErrorResponse(400, {
            error: 'Pastor Presidente só pode ter 1 inscrição por campo no lote.',
            stage: 'validacao_pastor_presidente_por_campo_lote',
            code: 'PASTOR_PRESIDENTE_DUPLICADO_CAMPO_LOTE',
            details: `Participante ${participanteOrdem} excede limite de Pastor Presidente no campo ${campoId}`,
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }
        return null;
      };

      for (let idx = 0; idx < todos.length; idx++) {
        const p = todos[idx] as Record<string, unknown>;
        const tipoParticipanteRaw = String(p.tipo_inscricao ?? '').trim() || null;
        const tipoParticipante = idx === 0 ? (tipoParticipanteRaw || tipoNome) : tipoParticipanteRaw;

        if (usaTipos && idx > 0 && !tipoParticipanteRaw) {
          return buildErrorResponse(400, {
            error: 'Tipo de inscrição obrigatório para cada participante do lote.',
            stage: 'validacao_tipo_inscricao_lote',
            code: 'TIPO_INSCRICAO_OBRIGATORIO_LOTE',
            details: `Participante ${idx + 1} sem tipo_inscricao`,
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }

        if (usaTipos && !tipoParticipante) {
          return buildErrorResponse(400, {
            error: `Participante ${idx + 1} sem categoria de inscrição.`,
            stage: 'validacao_tipo_inscricao_lote',
            code: 'TIPO_INSCRICAO_OBRIGATORIO_LOTE',
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }

        const tipoEvento = usaTipos ? resolveTipo(tipoParticipante) : null;
        if (usaTipos && !tipoEvento) {
          return buildErrorResponse(400, {
            error: `Categoria inválida para participante ${idx + 1}.`,
            stage: 'validacao_tipo_inscricao_lote',
            code: 'TIPO_INSCRICAO_INVALIDO_LOTE',
            details: `Categoria não encontrada/inativa: ${String(tipoParticipante ?? '').trim()}`,
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }

        const cpfParticipante = String(p.cpf ?? '').replace(/\D/g, '').trim();
        if (ehTipoEsposaJubilado(tipoParticipante)) {
          const vinculoConjugeParticipante = await resolverVinculoEsposaJubilado(cpfParticipante);
          if (!vinculoConjugeParticipante) {
            return buildErrorResponse(400, {
              error: `Categoria Esposa de Pastor Jubilado exige validação por cpf_conjuge (participante ${idx + 1}).`,
              stage: 'validacao_esposa_jubilado_lote',
              code: 'ESPOSA_JUBILADO_SEM_VINCULO_CPF_CONJUGE_LOTE',
              payloadResumo: { ...payloadResumo, evento_id: evento.id },
            });
          }
        }

        const sexoParticipanteNorm = normalizarSexo(p.sexo);
        if (sexoParticipanteNorm === 'M' && ehCategoriaFeminina(tipoParticipante)) {
          return buildErrorResponse(400, {
            error: `Categoria feminina inválida para sexo masculino (participante ${idx + 1}).`,
            stage: 'validacao_tipo_por_sexo_lote',
            code: 'TIPO_INVALIDO_SEXO_MASCULINO_LOTE',
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }
        if (sexoParticipanteNorm === 'F' && ehCategoriaMasculina(tipoParticipante)) {
          return buildErrorResponse(400, {
            error: `Categoria masculina inválida para sexo feminino (participante ${idx + 1}).`,
            stage: 'validacao_tipo_por_sexo_lote',
            code: 'TIPO_INVALIDO_SEXO_FEMININO_LOTE',
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }

        // Proteção: tipoEvento encontrado mas valor NULL → erro explícito (não herdar valor do titular)
        if (tipoEvento && (tipoEvento.valor === null || tipoEvento.valor === undefined)) {
          return buildErrorResponse(500, {
            error: `Tipo de inscrição sem valor configurado: "${tipoEvento.nome}". Corrija a configuração do evento.`,
            stage: 'validacao_valor_tipo_inscricao_lote',
            code: 'TIPO_SEM_VALOR_CONFIGURADO',
            details: `Participante ${idx + 1} — tipo "${tipoEvento.nome}" com valor NULL no banco.`,
            payloadResumo: { ...payloadResumo, evento_id: evento.id },
          });
        }
        let valorBaseParticipante = tipoEvento ? tipoEvento.valor : valorBase;
        if (ehTipoEsposaJubilado(tipoParticipante)) {
          valorBaseParticipante = 0;
        }
        const ministroParticipante = cpfParticipante ? ministrosPorCpf.get(cpfParticipante) : null;
        if (ministroParticipante) {
          const statusMin = String(ministroParticipante.status ?? '').toLowerCase();
          const minAtivo = statusMin === 'active' || statusMin === 'ativo';
          const minEhPP = !!ministroParticipante.pastor_presidente;
          const minEhPA = !!ministroParticipante.pastor_auxiliar;
          const minEhJub = !!ministroParticipante.jubilado;
          const sexoParticipanteMinNorm = normalizarSexo(p.sexo);
          const minPodePA = minEhPA || (minAtivo && sexoParticipanteMinNorm === 'M' && !minEhPP && !minEhJub);

          if (minAtivo && ehTipoVisitante(tipoParticipante)) {
            return buildErrorResponse(400, {
              error: `Ministro ativo não pode se inscrever como Visitante (participante ${idx + 1}).`,
              stage: 'validacao_tipo_ministro_ativo_lote',
              code: 'MINISTRO_ATIVO_VISITANTE_NAO_PERMITIDO_LOTE',
              payloadResumo: { ...payloadResumo, evento_id: evento.id },
            });
          }

          if (minAtivo && ehTipoPastorPresidente(tipoParticipante) && !minEhPP) {
            return buildErrorResponse(400, {
              error: `Participante ${idx + 1} não possui perfil de Pastor Presidente para essa categoria.`,
              stage: 'validacao_tipo_pastor_presidente_lote',
              code: 'PASTOR_PRESIDENTE_SEM_FLAG_LOTE',
              payloadResumo: { ...payloadResumo, evento_id: evento.id },
            });
          }

          if (minAtivo && ehTipoPastorAuxiliar(tipoParticipante) && !minPodePA) {
            return buildErrorResponse(400, {
              error: `Categoria Pastor Auxiliar incompatível no participante ${idx + 1}.`,
              stage: 'validacao_tipo_pastor_auxiliar_lote',
              code: 'PASTOR_AUXILIAR_INCOMPATIVEL_LOTE',
              payloadResumo: { ...payloadResumo, evento_id: evento.id },
            });
          }

          if (minAtivo && minEhJub && !ehTipoPastorJubilado(tipoParticipante)) {
            return buildErrorResponse(400, {
              error: `Ministro jubilado ativo deve usar categoria de Pastor Jubilado (participante ${idx + 1}).`,
              stage: 'validacao_tipo_jubilado_lote',
              code: 'JUBILADO_TIPO_INVALIDO_LOTE',
              payloadResumo: { ...payloadResumo, evento_id: evento.id },
            });
          }
        }
        const campoIdParticipante = String(p.campo_id ?? '').trim() || null;
        const ehCampoMissionario = campoIdParticipante ? !!campoMissionarioMap.get(campoIdParticipante) : false;

        const erroPPDuplicado = validarPastorPresidentePorCampo(
          campoIdParticipante,
          tipoEvento?.nome ?? tipoParticipante,
          idx + 1,
        );
        if (erroPPDuplicado) return erroPPDuplicado;

        if (evento.departamento === 'AGO' && descontoCMHabilitado && ehCampoMissionario) {
          if (ehTipoPastorPresidente(tipoEvento?.nome ?? tipoParticipante) && valorCmPastor > 0) {
            valorBaseParticipante = valorCmPastor;
          }
          if (ehTipoEsposaPastorPresidente(tipoEvento?.nome ?? tipoParticipante) && valorCmEsposa > 0) {
            valorBaseParticipante = valorCmEsposa;
          }
        }

        let descontoParticipante = 0;
        let cupomParticipante: string | null = null;
        if (cupom_codigo) {
          const cupom = await calcularDesconto(supabase, evento.id, cupom_codigo, valorBaseParticipante);
          if (cupom) {
            descontoParticipante = cupom.desconto;
            cupomParticipante = String(cupom_codigo).trim().toUpperCase();
          }
        }

        const valorFinalParticipante = Math.max(0, valorBaseParticipante - descontoParticipante);
        const alimentacaoParticipante = evento.departamento === 'AGO' ? true : !!(tipoEvento?.inclui_alimentacao ?? false);
        const refeicoesParticipante = evento.departamento === 'AGO'
          ? 12
          : (alimentacaoParticipante ? Math.max(0, Number(tipoEvento?.quantidade_refeicoes ?? 0)) : 0);
        const hospedagemParticipante = evento.departamento === 'AGO'
          ? !!p.hospedagem
          : (!!(tipoEvento?.inclui_hospedagem ?? false) || !!p.hospedagem);

        calculados.push({
          nome_inscrito: String(p.nome_inscrito ?? '').trim(),
          cpf: String(p.cpf ?? '').replace(/\D/g, '') || null,
          email: String(p.email ?? '').trim() || null,
          telefone: String(p.telefone ?? '').trim() || null,
          whatsapp: String(p.whatsapp ?? '').trim() || null,
          sexo: String(p.sexo ?? '').trim() || null,
          data_nascimento: String(p.data_nascimento ?? '').trim() || null,
          supervisao_id: String(p.supervisao_id ?? '').trim() || null,
          campo_id: campoIdParticipante,
          hospedagem: hospedagemParticipante,
          brinde: !!p.brinde,
          qr_code: String(p.qr_code ?? '').trim() || null,
          tipo_inscricao: tipoEvento?.nome ?? tipoParticipante,
          valor_original: valorBaseParticipante,
          desconto_valor: descontoParticipante,
          valor_final: valorFinalParticipante,
          cupom_codigo: cupomParticipante,
          alimentacao: alimentacaoParticipante,
          refeicoes: refeicoesParticipante,
          hosp_necessidade_especial: !!p.hosp_necessidade_especial,
          hosp_descricao_necessidade: String(p.hosp_descricao_necessidade ?? '').trim() || null,
          hosp_observacoes: String(p.hosp_observacoes ?? '').trim() || null,
          hosp_possui_comorbidade: !!p.hosp_possui_comorbidade,
          hosp_descricao_comorbidade: String(p.hosp_descricao_comorbidade ?? '').trim() || null,
        });
      }

      const valorTotalLote = calculados.reduce((acc, p) => acc + p.valor_final, 0);
      const descontoTotalLote = calculados.reduce((acc, p) => acc + p.desconto_valor, 0);
      const isGratuitoLote = valorTotalLote <= 0;
      const codigoLote     = gerarCodigoLote();

      const lotePayload = normalizePayloadUppercase({
        evento_id:            evento.id,
        codigo:               codigoLote,
        responsavel_nome:     nome_inscrito.trim(),
        responsavel_email:    email?.trim() || null,
        responsavel_whatsapp: whatsapp?.trim() || null,
        valor_total:          valorTotalLote,
        status_pagamento:     isGratuitoLote ? 'isento' : 'pendente',
        cupom_codigo:         cupomUsado,
        desconto_valor:       descontoTotalLote,
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

      const rows = calculados.map((p, idx) => {
        const pComorb = !!(p as any).hosp_possui_comorbidade;
        const pCamaInferiorAuto = evento.departamento === 'AGO'
          ? resolveCamaInferiorAutomatica({
            sexo: (p.sexo as string) || null,
            data_nascimento: (p.data_nascimento as string) || null,
            tipo_inscricao: p.tipo_inscricao,
            hosp_necessidade_especial: !!(p as any).hosp_necessidade_especial,
            hosp_possui_comorbidade: pComorb,
          })
          : false;
        const pGrupoAuto = evento.departamento === 'AGO'
          ? resolveGrupoHospedagemAGO({
            sexo: (p.sexo as string) || null,
            data_nascimento: (p.data_nascimento as string) || null,
            tipo_inscricao: p.tipo_inscricao,
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
        supervisao_id:    p.supervisao_id || null,
        campo_id:         p.campo_id || null,
        hospedagem:       !!p.hospedagem,
        alimentacao:      p.alimentacao,
        brinde:           !!p.brinde,
        tipo_inscricao:   p.tipo_inscricao,
        valor_original:   p.valor_original,
        cupom_codigo:     p.cupom_codigo,
        desconto_valor:   p.desconto_valor,
        valor_final:      p.valor_final,
        valor_pago:       0,
        status_pagamento: isGratuitoLote ? 'isento' : 'pendente',
        qr_code:          p.qr_code || null,
        refeicoes_total:  p.refeicoes,
        refeicoes_utilizadas: 0,
        quantidade_refeicoes_total: p.refeicoes,
        quantidade_refeicoes_usadas: 0,
        quantidade_refeicoes_saldo: p.refeicoes,
        hosp_necessidade_especial: !!(p as any).hosp_necessidade_especial,
        hosp_descricao_necessidade: ((p as any).hosp_descricao_necessidade as string)?.trim() || null,
        hosp_cama_inferior: pCamaInferiorAuto,
        hosp_observacoes: ((p as any).hosp_observacoes as string)?.trim() || null,
        hosp_possui_comorbidade: pComorb,
        hosp_descricao_comorbidade: ((p as any).hosp_descricao_comorbidade as string)?.trim() || null,
        grupo_hospedagem: pGrupoAuto,
        responsavel_pagamento: idx === 0,
        lgpd_aceito:      true,
        lgpd_aceito_em:   new Date().toISOString(),
      });
      });

      stage = 'insert_evento_inscricoes_lote';
      const { error: insRowsErr, colunasRemovidas: loteColunasRemovidas } = await insertLoteComFallback(
        supabase,
        rows as Record<string, unknown>[],
      );
      if (insRowsErr) {
        return buildErrorResponse(500, {
          error: 'Erro ao inserir inscrições do lote',
          stage,
          details: insRowsErr?.message ?? null,
          code: (insRowsErr as any)?.code ?? null,
          payloadResumo: {
            ...payloadResumo,
            evento_id: evento.id,
            valor_final: valorTotalLote,
            colunas_removidas_fallback: loteColunasRemovidas,
          },
        });
      }

      await Promise.all(
        calculados.map((p) => sincronizarFichaMembroPorInscricao(supabase, {
          cpf: p.cpf,
          email: p.email,
          whatsapp: p.whatsapp,
          campoId: p.campo_id,
        })),
      );

      if (cupomUsado) await incrementarCupom(supabase, evento.id, cupomUsado, todos.length);

      if (isGratuitoLote) {
        return NextResponse.json({ loteId: lote.id, inscricoes: todos.length, statusPagamento: 'isento', pagamento: null });
      }

      try {
        stage = 'criar_asaas_lote';
        const customerId = await createOrFindAsaasCustomer({ nome: nome_inscrito.trim(), email: email?.trim() || null, cpf: cleanCpf(cpf), whatsapp: whatsapp || null });
        const dueDateLote = dueDateFromNow();
        const linhasDescricao = calculados
          .slice(0, 12)
          .map(p => `${p.nome_inscrito}: ${p.tipo_inscricao ?? 'Sem categoria'}: R$ ${p.valor_final.toFixed(2).replace('.', ',')}`)
          .join(' | ');
        const pagamento  = await createEventoPayment({
          customerId,
          value: valorTotalLote,
          dueDate: dueDateLote,
          description: `Lote ${codigoLote} — ${evento.nome} (${todos.length} insc.)${linhasDescricao ? ` | ${linhasDescricao}` : ''}`,
          externalReference: `lote:${lote.id}`,
        });
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
      alimentacao:      evento.departamento === 'AGO' ? true : tipoInclui.alimentacao,
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
      refeicoes_total:  evento.departamento === 'AGO' ? 12 : (tipoInclui.alimentacao ? tipoRefeicoes : 0),
      refeicoes_utilizadas: 0,
      quantidade_refeicoes_total: evento.departamento === 'AGO' ? 12 : (tipoInclui.alimentacao ? tipoRefeicoes : 0),
      quantidade_refeicoes_usadas: 0,
      quantidade_refeicoes_saldo: evento.departamento === 'AGO' ? 12 : (tipoInclui.alimentacao ? tipoRefeicoes : 0),
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

    await sincronizarFichaMembroPorInscricao(supabase, {
      cpf: cpf?.replace(/\D/g, '') || null,
      email: email?.trim() || null,
      whatsapp: whatsapp?.trim() || null,
      campoId: campo_id || null,
    });

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
      });

      if (evento.departamento === 'AGO' && querHospedagem) {
        await alocarLeitoParaInscricao(supabase, inscricao.id);
      }

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
