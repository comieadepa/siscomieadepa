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

export function identificarResponsavelFinanceiro(
  inscricao: { id: string; nome_inscrito: string; cpf?: string | null; responsavel_pagamento?: boolean | null },
  lote: LoteFinanceiro | null,
  outrasInscricoesDoLote?: { id: string; nome_inscrito: string; cpf?: string | null; responsavel_pagamento?: boolean | null }[]
): boolean {
  // 1. responsavel_pagamento === true
  if (inscricao.responsavel_pagamento === true) return true;
  if (inscricao.responsavel_pagamento === false) return false;

  if (!lote) return false;

  const nomeIns = norm(inscricao.nome_inscrito);
  const nomeResp = norm(lote.responsavel_nome);

  // 2. lote.responsavel_cpf
  if (lote.responsavel_cpf && inscricao.cpf) {
    if (cleanCpf(inscricao.cpf) === cleanCpf(lote.responsavel_cpf)) {
      return true;
    }
  }

  // 3. lote.responsavel_nome
  if (nomeResp && nomeIns === nomeResp) {
    return true;
  }

  // 4. Verificar se ALGUM OUTRO participante já atende aos critérios acima
  const alguemJaIdentificado = outrasInscricoesDoLote?.some(o => {
    if (o.id === inscricao.id) return false;
    if (o.responsavel_pagamento === true) return true;
    if (lote.responsavel_cpf && o.cpf && cleanCpf(o.cpf) === cleanCpf(lote.responsavel_cpf)) return true;
    const oNome = norm(o.nome_inscrito);
    if (nomeResp && oNome === nomeResp) return true;
    return false;
  });

  // 5. Fallback por ordenação de ID (somente se ninguém foi identificado)
  if (!alguemJaIdentificado && outrasInscricoesDoLote && outrasInscricoesDoLote.length > 0) {
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
  outrasInscricoesDoLote?: { id: string; nome_inscrito: string; cpf?: string | null; responsavel_pagamento?: boolean | null }[]
): number {
  if (inscricao.lote_id) {
    const isResp = identificarResponsavelFinanceiro(inscricao, lote, outrasInscricoesDoLote);
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
  outrasInscricoesDoLote?: { id: string; nome_inscrito: string; cpf?: string | null; responsavel_pagamento?: boolean | null }[]
): string {
  if (inscricao.lote_id) {
    const isResp = identificarResponsavelFinanceiro(inscricao, lote, outrasInscricoesDoLote);
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
