import { createServerClient } from '@/lib/supabase-server';
import {
  VALOR_PADRAO_CARTEIRINHA_UMADESPA,
  VALIDADE_PADRAO_MESES,
  IDADE_MAXIMA_CADASTRO_PUBLICO,
} from './constants';
import type {
  UmadespaConfiguracao,
  UmadespaCarteirinhaSolicitacao,
} from './types';

/**
 * Obtém os parâmetros operacionais vigentes para o ano corrente da UMADESPA
 * Retorna valores padrão seguros caso não haja registro persistido.
 */
export async function getUmadespaConfiguracoesVigentes(): Promise<UmadespaConfiguracao> {
  const supabase = createServerClient();
  const anoAtual = new Date().getFullYear();

  try {
    const { data, error } = await supabase
      .from('umadespa_configuracoes')
      .select('*')
      .eq('ano_exercicio', anoAtual)
      .maybeSingle();

    if (error || !data) {
      return {
        id: 'default',
        ano_exercicio: anoAtual,
        taxa_primeira_via: VALOR_PADRAO_CARTEIRINHA_UMADESPA,
        taxa_segunda_via: VALOR_PADRAO_CARTEIRINHA_UMADESPA,
        meses_validade_carteirinha: VALIDADE_PADRAO_MESES,
        idade_maxima_cadastro_publico: IDADE_MAXIMA_CADASTRO_PUBLICO,
        permite_cadastro_publico: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    return {
      ...data,
      taxa_primeira_via: Number(data.taxa_primeira_via),
      taxa_segunda_via: Number(data.taxa_segunda_via),
    };
  } catch {
    return {
      id: 'default',
      ano_exercicio: anoAtual,
      taxa_primeira_via: VALOR_PADRAO_CARTEIRINHA_UMADESPA,
      taxa_segunda_via: VALOR_PADRAO_CARTEIRINHA_UMADESPA,
      meses_validade_carteirinha: VALIDADE_PADRAO_MESES,
      idade_maxima_cadastro_publico: IDADE_MAXIMA_CADASTRO_PUBLICO,
      permite_cadastro_publico: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

/**
 * Calcula a data de expiração da carteirinha com base nos meses de validade
 */
export function calcularDataValidadeCarteirinha(mesesValidade: number, aPartirDe = new Date()): string {
  const d = new Date(aPartirDe);
  d.setMonth(d.getMonth() + mesesValidade);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Valida a integridade da hierarquia eclesiástica informada (Supervisão → Campo → Congregação)
 */
export async function validarHierarquiaEclesiastica(params: {
  supervisaoId: string;
  campoId: string;
  congregacaoId?: string | null;
}): Promise<{ valido: boolean; erro?: string }> {
  const supabase = createServerClient();

  // 1. Verifica se o campo pertence à supervisão
  const { data: campo, error: campoErr } = await supabase
    .from('campos')
    .select('id, supervisao_id, nome')
    .eq('id', params.campoId)
    .maybeSingle();

  if (campoErr || !campo) {
    return { valido: false, erro: 'Campo eclesiástico não encontrado.' };
  }

  if (campo.supervisao_id !== params.supervisaoId) {
    return { valido: false, erro: 'O Campo selecionado não pertence à Supervisão informada.' };
  }

  // 2. Se informada congregação, verifica se pertence ao campo
  if (params.congregacaoId) {
    const { data: congregacao, error: congErr } = await supabase
      .from('congregacoes')
      .select('id, campo_id, nome')
      .eq('id', params.congregacaoId)
      .maybeSingle();

    if (congErr || !congregacao) {
      return { valido: false, erro: 'Congregação selecionada não encontrada.' };
    }

    if (congregacao.campo_id !== params.campoId) {
      return { valido: false, erro: 'A Congregação selecionada não pertence ao Campo informado.' };
    }
  }

  return { valido: true };
}

/**
 * Determina a próxima via e o valor correspondente para a solicitação de carteirinha
 */
export async function calcularProximaViaEValor(associadoId: string): Promise<{
  via: number;
  valor: number;
  validadeMeses: number;
  validadeData: string;
}> {
  const supabase = createServerClient();
  const config = await getUmadespaConfiguracoesVigentes();

  // Busca última via já registrada para o associado
  const { data: ultimasVias } = await supabase
    .from('umadespa_carteirinhas_solicitacoes')
    .select('via')
    .eq('associado_id', associadoId)
    .order('via', { ascending: false })
    .limit(1);

  const ultimaVia = ultimasVias && ultimasVias.length > 0 ? Number(ultimasVias[0].via) : 0;
  const proximaVia = ultimaVia + 1;

  const valor = proximaVia === 1 ? config.taxa_primeira_via : config.taxa_segunda_via;
  const validadeMeses = config.meses_validade_carteirinha;
  const validadeData = calcularDataValidadeCarteirinha(validadeMeses);

  return {
    via: proximaVia,
    valor,
    validadeMeses,
    validadeData,
  };
}

/**
 * Cria ou recupera uma solicitação de carteirinha preparada para a UMADESPA
 * (Mantendo idempotência e sem disparar chamada externa ao gateway ASAAS neste lote)
 */
export async function prepararSolicitacaoCarteirinha(params: {
  associadoId: string;
  formaPagamento?: string;
  operadorId?: string | null;
  observacoes?: string | null;
}): Promise<{
  solicitacao: UmadespaCarteirinhaSolicitacao | null;
  reutilizada: boolean;
  erro?: string;
}> {
  const supabase = createServerClient();

  // 1. Verifica se já existe solicitação em andamento (aguardando ou processando)
  const { data: existente } = await supabase
    .from('umadespa_carteirinhas_solicitacoes')
    .select('*')
    .eq('associado_id', params.associadoId)
    .in('status', ['aguardando_pagamento', 'processando_pagamento'])
    .maybeSingle();

  if (existente) {
    return {
      solicitacao: existente as UmadespaCarteirinhaSolicitacao,
      reutilizada: true,
    };
  }

  // 2. Calcula nova via e taxas
  const viaCalculada = await calcularProximaViaEValor(params.associadoId);
  const idempotencyKey = `umadespa_cart_${params.associadoId}_v${viaCalculada.via}_${Date.now()}`;

  const payloadInsert = {
    associado_id: params.associadoId,
    via: viaCalculada.via,
    valor: viaCalculada.valor,
    validade_meses: viaCalculada.validadeMeses,
    validade_data: viaCalculada.validadeData,
    idempotency_key: idempotencyKey,
    status: 'aguardando_pagamento',
    solicitado_em: new Date().toISOString(),
    observacoes: params.observacoes || null,
  };

  const { data: nova, error: insertErr } = await supabase
    .from('umadespa_carteirinhas_solicitacoes')
    .insert([payloadInsert])
    .select('*')
    .maybeSingle();

  if (insertErr || !nova) {
    return {
      solicitacao: null,
      reutilizada: false,
      erro: insertErr?.message || 'Erro ao registrar solicitação de carteirinha.',
    };
  }

  return {
    solicitacao: nova as UmadespaCarteirinhaSolicitacao,
    reutilizada: false,
  };
}
