export interface LoteFinanceiro {
  id: string;
  valor_total: number;
  responsavel_nome?: string | null;
  responsavel_cpf?: string | null;
}

export interface InscricaoFinanceiro {
  id: string;
  lote_id: string | null;
  responsavel_pagamento?: boolean | null;
  valor_final: number | null;
  valor_pago: number | null;
  nome_inscrito: string;
  cpf: string | null;
}

const norm = (s?: string | null) => s ? s.trim().toUpperCase().replace(/\s+/g, ' ') : '';
const cleanCpf = (c?: string | null) => c ? c.replace(/\D/g, '') : '';

export function isResponsavelPagamento(
  inscricao: { id: string; nome_inscrito: string; cpf?: string | null; responsavel_pagamento?: boolean | null },
  lote: LoteFinanceiro | null,
  outrasInscricoesDoLote?: { id: string; nome_inscrito: string; cpf?: string | null }[]
): boolean {
  if (inscricao.responsavel_pagamento === true) return true;
  if (inscricao.responsavel_pagamento === false) return false;

  // Se responsavel_pagamento for null
  if (!lote) return false;

  const nomeIns = norm(inscricao.nome_inscrito);
  const nomeResp = norm(lote.responsavel_nome);

  // Se houver cpf no lote
  if (lote.responsavel_cpf && inscricao.cpf) {
    if (cleanCpf(inscricao.cpf) === cleanCpf(lote.responsavel_cpf)) {
      return true;
    }
  }

  // Se o nome bate com o responsável do lote
  if (nomeResp && nomeIns === nomeResp) {
    return true;
  }

  // Caso não consiga identificar e houver a lista de participantes do mesmo lote
  if (outrasInscricoesDoLote && outrasInscricoesDoLote.length > 0) {
    const sorted = [...outrasInscricoesDoLote].sort((a, b) => a.id.localeCompare(b.id));
    if (sorted[0]?.id === inscricao.id) {
      console.warn(`[FINANCEIRO-ALERTA] responsavel_pagamento nulo/indefinido para lote ${lote.id}. Elegendo participante ID ${inscricao.id} como responsável fallback.`);
      return true;
    }
  }

  return false;
}

export function calcularValorFinanceiroInscricao(
  inscricao: InscricaoFinanceiro,
  lote: LoteFinanceiro | null,
  outrasInscricoesDoLote?: { id: string; nome_inscrito: string; cpf?: string | null }[]
): number {
  if (inscricao.lote_id) {
    const isResp = isResponsavelPagamento(inscricao, lote, outrasInscricoesDoLote);
    if (isResp) {
      return lote ? lote.valor_total : 0;
    } else {
      return 0;
    }
  } else {
    if (inscricao.valor_final !== null && inscricao.valor_final !== undefined) {
      return inscricao.valor_final;
    }
    if (inscricao.valor_pago !== null && inscricao.valor_pago !== undefined) {
      return inscricao.valor_pago;
    }
    return 0;
  }
}

export function formatarValorUI(
  inscricao: {
    id: string;
    lote_id: string | null;
    responsavel_pagamento?: boolean | null;
    valor_final: number | null;
    valor_pago: number | null;
    nome_inscrito: string;
    cpf?: string | null;
  },
  lote: LoteFinanceiro | null,
  outrasInscricoesDoLote?: { id: string; nome_inscrito: string; cpf?: string | null }[]
): string {
  if (inscricao.lote_id) {
    const isResp = isResponsavelPagamento(inscricao, lote, outrasInscricoesDoLote);
    if (isResp) {
      const v = lote ? lote.valor_total : 0;
      return `${v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (lote)`;
    } else {
      return 'Pago no lote';
    }
  } else {
    const val = inscricao.valor_final !== null && inscricao.valor_final !== undefined
      ? inscricao.valor_final
      : (inscricao.valor_pago !== null && inscricao.valor_pago !== undefined ? inscricao.valor_pago : 0);
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}
