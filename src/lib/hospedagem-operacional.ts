export const PAGAMENTO_ELEGIVEL = new Set(['pago', 'isento']);
export const PAGAMENTO_BLOQUEADO = new Set([
  'pendente',
  'aguardando_pagamento',
  'cancelado',
  'recusado',
]);

export type StatusOperacionalHospedagem =
  | 'solicitada'
  | 'aguardando_pagamento'
  | 'elegivel'
  | 'alocada'
  | 'confirmada'
  | 'checkin_realizado'
  | 'lista_espera';

export interface HospedagemStatusInput {
  status?: string | null;
  status_pagamento?: string | null;
  alojamento_id?: string | null;
  tipo_cama?: string | null;
  numero_cama?: string | null;
  hospedagem?: boolean;
}

export function isPagamentoElegivel(statusPagamento: string | null | undefined): boolean {
  return PAGAMENTO_ELEGIVEL.has((statusPagamento ?? '').toLowerCase());
}

export function isPagamentoBloqueado(statusPagamento: string | null | undefined): boolean {
  return PAGAMENTO_BLOQUEADO.has((statusPagamento ?? '').toLowerCase());
}

export function temAlocacaoCompleta(input: {
  alojamento_id?: string | null;
  tipo_cama?: string | null;
  numero_cama?: string | null;
}): boolean {
  return !!input.alojamento_id && !!input.tipo_cama && !!input.numero_cama;
}

export function resolveStatusOperacionalHospedagem(
  input: HospedagemStatusInput,
): StatusOperacionalHospedagem {
  const status = (input.status ?? '').toLowerCase();
  const pagamentoElegivel = isPagamentoElegivel(input.status_pagamento);

  if (status === 'checkin_realizado' || status === 'checkout_realizado') {
    return 'checkin_realizado';
  }
  if (status === 'confirmada') return 'confirmada';
  if (status === 'lista_espera') return 'lista_espera';

  if (!pagamentoElegivel) {
    return 'aguardando_pagamento';
  }

  if (temAlocacaoCompleta(input)) {
    return 'alocada';
  }

  return 'elegivel';
}

export function isElegivelAutoalocacao(input: HospedagemStatusInput): boolean {
  if (!input.hospedagem) return false;
  if (!isPagamentoElegivel(input.status_pagamento)) return false;

  const status = (input.status ?? '').toLowerCase();
  if (status === 'checkin_realizado' || status === 'checkout_realizado' || status === 'confirmada') {
    return false;
  }

  return !temAlocacaoCompleta(input);
}

export function formatarNumeroLeitoSequencial(valor: number): string {
  return String(Math.max(1, valor)).padStart(3, '0');
}
